import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { agentService } from '@/services';
import type {
  AgentAction,
  AgentContext,
  AgentInputMode,
  AgentMessage,
  AgentResponse,
  SosStatus,
  VoiceConnection,
} from '@/types/agent';
import { makeId, nowIso } from '@/utils/format';
import { agentActionBus } from './agentActionBus';
import { useSession } from './SessionProvider';
import { useVoiceController, type VoiceSession } from './useVoiceController';

export type { VoiceSession } from './useVoiceController';

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
  /** Open the voice overlay (mic button, "Ask Cat about this"). */
  startVoice: (context?: AgentContext) => void;
  cancelVoice: () => void;
  dismissVoice: () => void;
  /** Live voice session state. */
  voiceConnection: VoiceConnection;
  voiceConnectionDetail?: string;
  /** Listening for the wake phrase in the background. */
  handsFree: boolean;
  connectVoice: () => Promise<void>;
  disconnectVoice: () => Promise<void>;
  /** False when a demo voice stands in (Expo Go / mock mode). */
  voiceIsLive: boolean;
  /** Push-to-talk (Expo Go): each tap records one question, no wake phrase. */
  pushToTalk: boolean;
  /** Push-to-talk: stop recording now and send. */
  finishTalking: () => void;
  wakePhrase: string;

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
    imageUrl: response.imageUrl,
    manual: response.manual,
  };
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const { workerId } = useSession();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [historyNonce, setHistoryNonce] = useState(0);
  // Which load request the current history result belongs to.
  const [historyResult, setHistoryResult] = useState<{ nonce: number; error?: Error }>();
  const historyLoading = historyResult?.nonce !== historyNonce;
  const historyError = historyLoading ? undefined : historyResult?.error;
  const [pendingCount, setPendingCount] = useState(0);
  const [chatContext, setChatContext] = useState<AgentContext>();
  const [sos, setSos] = useState<SosStatus | null>(null);

  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const screenContextRef = useRef<AgentContext | undefined>(undefined);

  // A different worker on the phone starts a clean conversation.
  const [conversationOwner, setConversationOwner] = useState(workerId);
  if (conversationOwner !== workerId) {
    setConversationOwner(workerId);
    setMessages([]);
    setChatContext(undefined);
    setSos(null);
  }

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
  }, [historyNonce, workerId]);

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

  const appendRef = useRef(appendMessages);
  useEffect(() => {
    appendRef.current = appendMessages;
  });
  const voiceCtl = useVoiceController({
    getScreenContext: () => screenContextRef.current,
    onExchange: (m) => appendRef.current(m),
  });

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
      case 'OPEN_MANUAL':
        router.push({ pathname: '/manual', params: action.page ? { page: String(action.page) } : {} });
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
      voice: voiceCtl.voice,
      overlayVisible: voiceCtl.overlayVisible,
      startVoice: voiceCtl.startVoice,
      cancelVoice: voiceCtl.cancelVoice,
      dismissVoice: voiceCtl.dismissVoice,
      voiceConnection: voiceCtl.connection,
      voiceConnectionDetail: voiceCtl.connectionDetail,
      handsFree: voiceCtl.handsFree,
      connectVoice: voiceCtl.connectVoice,
      disconnectVoice: voiceCtl.disconnectVoice,
      voiceIsLive: voiceCtl.voiceIsLive,
      pushToTalk: voiceCtl.pushToTalk,
      finishTalking: voiceCtl.finishTalking,
      wakePhrase: voiceCtl.wakePhrase,
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
      voiceCtl.voice,
      voiceCtl.overlayVisible,
      voiceCtl.startVoice,
      voiceCtl.cancelVoice,
      voiceCtl.dismissVoice,
      voiceCtl.connection,
      voiceCtl.connectionDetail,
      voiceCtl.handsFree,
      voiceCtl.connectVoice,
      voiceCtl.disconnectVoice,
      voiceCtl.voiceIsLive,
      voiceCtl.pushToTalk,
      voiceCtl.finishTalking,
      voiceCtl.wakePhrase,
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
