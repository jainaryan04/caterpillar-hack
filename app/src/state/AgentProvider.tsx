import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { agentService, voiceService } from '@/services';
import type {
  AgentAction,
  AgentContext,
  AgentInputMode,
  AgentMessage,
  AgentResponse,
  SosStatus,
  VoicePhase,
} from '@/types/agent';
import { makeId, nowIso } from '@/utils/format';
import { agentActionBus } from './agentActionBus';

export interface VoiceSession {
  phase: VoicePhase;
  transcript: string;
  context?: AgentContext;
  response?: AgentResponse;
  error?: string;
}

interface AgentState {
  messages: AgentMessage[];
  historyLoading: boolean;
  historyError?: Error;
  reloadHistory: () => void;
  /** A text question is waiting for an answer. */
  isThinking: boolean;
  sendText: (text: string, context?: AgentContext) => void;
  retryMessage: (messageId: string) => void;
  /** Add a finished exchange from elsewhere (e.g. the camera flow). */
  appendMessages: (messages: AgentMessage[]) => void;

  voice: VoiceSession;
  overlayVisible: boolean;
  startVoice: (context?: AgentContext) => void;
  finishSpeaking: () => void;
  cancelVoice: () => void;
  dismissVoice: () => void;
  /** True when the voice service offers a demo wake-word trigger. */
  canSimulateWakeWord: boolean;
  simulateWakeWord: () => void;

  /** What the current screen is showing; attached to wake-word questions. */
  setScreenContext: (context: AgentContext | undefined) => void;
  /** Context pinned to the chat composer ("Asking about: ..."). */
  chatContext?: AgentContext;
  setChatContext: (context: AgentContext | undefined) => void;

  sos: SosStatus | null;
  dismissSos: () => void;

  runAction: (action: AgentAction) => void;
}

const AgentStateContext = createContext<AgentState | null>(null);

const IDLE: VoiceSession = { phase: 'idle', transcript: '' };

function operatorMessage(text: string, mode: AgentInputMode, context?: AgentContext): AgentMessage {
  return { id: makeId('MSG'), role: 'operator', text, createdAt: nowIso(), mode, status: 'sent', context };
}

function agentMessage(response: AgentResponse, mode: AgentInputMode): AgentMessage {
  return {
    id: response.id,
    role: 'agent',
    text: response.text,
    createdAt: response.createdAt,
    mode,
    status: 'sent',
    caution: response.caution,
    citations: response.citations,
    actions: response.actions,
  };
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [historyNonce, setHistoryNonce] = useState(0);
  // Which load request the current history result belongs to.
  const [historyResult, setHistoryResult] = useState<{ nonce: number; error?: Error }>();
  const historyLoading = historyResult?.nonce !== historyNonce;
  const historyError = historyLoading ? undefined : historyResult?.error;
  const [pendingCount, setPendingCount] = useState(0);
  const [voice, setVoice] = useState<VoiceSession>(IDLE);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [chatContext, setChatContext] = useState<AgentContext>();
  const [sos, setSos] = useState<SosStatus | null>(null);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const screenContextRef = useRef<AgentContext | undefined>(undefined);
  const voiceRef = useRef<VoiceSession>(IDLE);
  // Bumped on every new voice session so late answers from a cancelled one are ignored.
  const voiceSessionRef = useRef(0);

  const updateVoice = useCallback((next: VoiceSession) => {
    voiceRef.current = next;
    setVoice(next);
  }, []);

  // History
  useEffect(() => {
    let cancelled = false;
    agentService
      .getHistory()
      .then((h) => {
        if (cancelled) return;
        setMessages((current) => (current.length ? current : h));
        setHistoryResult({ nonce: historyNonce });
      })
      .catch((e: unknown) => {
        if (!cancelled) setHistoryResult({ nonce: historyNonce, error: e instanceof Error ? e : new Error(String(e)) });
      });
    return () => {
      cancelled = true;
    };
  }, [historyNonce]);

  // SOS updates pushed by the backend
  useEffect(() => agentService.onSosStatus(setSos), []);

  // Text chat
  const ask = useCallback((message: AgentMessage) => {
    setPendingCount((n) => n + 1);
    agentService
      .sendMessage(message.text, message.context)
      .then((response) => setMessages((m) => [...m, agentMessage(response, message.mode)]))
      .catch(() =>
        setMessages((m) => m.map((x) => (x.id === message.id ? { ...x, status: 'failed' } : x))),
      )
      .finally(() => setPendingCount((n) => n - 1));
  }, []);

  const sendText = useCallback(
    (text: string, context?: AgentContext) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const msg = operatorMessage(trimmed, context?.imageUri ? 'image' : 'text', context);
      setMessages((m) => [...m, msg]);
      ask(msg);
    },
    [ask],
  );

  const retryMessage = useCallback(
    (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId);
      if (!msg) return;
      const retried = { ...msg, status: 'sent' as const };
      setMessages((current) => current.map((m) => (m.id === messageId ? retried : m)));
      ask(retried);
    },
    [ask],
  );

  const appendMessages = useCallback((extra: AgentMessage[]) => setMessages((m) => [...m, ...extra]), []);

  // Voice
  const startVoice = useCallback(
    (context?: AgentContext) => {
      voiceSessionRef.current += 1;
      const ctx = context ?? screenContextRef.current;
      updateVoice({ phase: 'listening', transcript: '', context: ctx });
      setOverlayVisible(true);
      voiceService.startListening({ context: ctx });
    },
    [updateVoice],
  );

  const finishSpeaking = useCallback(() => {
    if (voiceRef.current.phase === 'listening') voiceService.stopListening();
  }, []);

  const cancelVoice = useCallback(() => {
    voiceSessionRef.current += 1;
    voiceService.cancel();
    updateVoice(IDLE);
    setOverlayVisible(false);
  }, [updateVoice]);

  const dismissVoice = cancelVoice;

  useEffect(() => {
    const offTranscript = voiceService.onTranscript((text, isFinal) => {
      const current = voiceRef.current;
      if (current.phase !== 'listening') return;
      if (!isFinal) {
        updateVoice({ ...current, transcript: text });
        return;
      }
      const session = voiceSessionRef.current;
      const context = current.context;
      updateVoice({ ...current, transcript: text, phase: 'thinking' });
      const question = operatorMessage(text, 'voice', context);
      agentService
        .sendMessage(text, context)
        .then((response) => {
          if (session !== voiceSessionRef.current) return;
          setMessages((m) => [...m, question, agentMessage(response, 'voice')]);
          updateVoice({ ...voiceRef.current, phase: 'responding', response });
        })
        .catch((e: unknown) => {
          if (session !== voiceSessionRef.current) return;
          updateVoice({
            ...voiceRef.current,
            phase: 'error',
            error: e instanceof Error ? e.message : 'Jarvis is unavailable right now.',
          });
        });
    });
    const offError = voiceService.onError((message) => {
      if (voiceRef.current.phase === 'listening') updateVoice({ ...voiceRef.current, phase: 'error', error: message });
    });
    const offWake = voiceService.onWakeWordDetected(() => {
      // Ignore the wake word while a session is already on screen.
      if (voiceRef.current.phase === 'idle') startVoice();
    });
    return () => {
      offTranscript();
      offError();
      offWake();
    };
  }, [startVoice, updateVoice]);

  const simulateWakeWord = useCallback(() => voiceService.simulateWakeWord?.(), []);

  const setScreenContext = useCallback((context: AgentContext | undefined) => {
    screenContextRef.current = context;
  }, []);

  // Actions. Navigation and in-app controls are handled here; anything that
  // needs the backend (SOS, contacting the supervisor) has already been done
  // server-side by the time the action reaches the app.
  const runAction = useCallback((action: AgentAction) => {
    switch (action.type) {
      case 'OPEN_TASK':
        router.push({ pathname: '/task/[id]', params: { id: action.taskId } });
        break;
      case 'OPEN_VIDEO':
        router.push({
          pathname: '/video/[id]',
          params: { id: action.videoId, t: action.timestamp !== undefined ? String(action.timestamp) : undefined },
        });
        break;
      case 'EXPLAIN_VIDEO':
        router.push({ pathname: '/video/[id]', params: { id: action.videoId, t: String(action.timestamp) } });
        break;
      case 'OPEN_LEARNING':
        router.navigate('/learn');
        break;
      case 'OPEN_CAMERA':
        router.push('/camera');
        break;
      case 'GET_CURRENT_TASK':
        router.navigate('/home');
        break;
      default:
        break;
    }
    agentActionBus.emit(action);
  }, []);

  const value = useMemo<AgentState>(
    () => ({
      messages,
      historyLoading,
      historyError,
      reloadHistory: () => setHistoryNonce((n) => n + 1),
      isThinking: pendingCount > 0,
      sendText,
      retryMessage,
      appendMessages,
      voice,
      overlayVisible,
      startVoice,
      finishSpeaking,
      cancelVoice,
      dismissVoice,
      canSimulateWakeWord: typeof voiceService.simulateWakeWord === 'function',
      simulateWakeWord,
      setScreenContext,
      chatContext,
      setChatContext,
      sos,
      dismissSos: () => setSos(null),
      runAction,
    }),
    [
      messages,
      historyLoading,
      historyError,
      pendingCount,
      sendText,
      retryMessage,
      appendMessages,
      voice,
      overlayVisible,
      startVoice,
      finishSpeaking,
      cancelVoice,
      dismissVoice,
      simulateWakeWord,
      setScreenContext,
      chatContext,
      sos,
      runAction,
    ],
  );

  return <AgentStateContext.Provider value={value}>{children}</AgentStateContext.Provider>;
}

export function useAgent(): AgentState {
  const ctx = useContext(AgentStateContext);
  if (!ctx) throw new Error('useAgent must be used inside <AgentProvider>');
  return ctx;
}
