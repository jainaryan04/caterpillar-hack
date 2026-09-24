import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { agentService, voiceService } from '@/services';
import { WAKE_PREFIX } from '@/services/voiceEvents';
import type {
  AgentContext,
  AgentMessage,
  AgentResponse,
  ManualRef,
  VoiceConnection,
  VoiceEvent,
  VoicePhase,
} from '@/types/agent';
import { makeId, nowIso } from '@/utils/format';

export interface ManualPagesView {
  url: string;
  page: number;
  pageEnd?: number;
  topic?: string | null;
  width: number;
  height: number;
}

export interface VoiceSession {
  phase: VoicePhase;
  /** What the operator is saying / said. */
  transcript: string;
  context?: AgentContext;
  /** Cat's answer so far (sentences arrive as they are spoken). */
  response?: AgentResponse;
  /** Short status such as "Checking the manual…" while Cat works. */
  status?: string;
  /** Guidance, e.g. "Start with “Hey Cat”". */
  hint?: string;
  error?: string;
  pages?: ManualPagesView;
}

const IDLE: VoiceSession = { phase: 'idle', transcript: '' };

/** Lines Cat says while a tool runs; shown as status, not as the answer. */
const FILLERS: Record<string, string> = {
  'let me check the manual.': 'Checking the manual…',
  'let me look.': 'Looking at your screen…',
};
/** Cat pauses between "Let me check the manual." and the answer; wait this long before calling it done. */
const DONE_AFTER_MS = 2500;
const NO_ANSWER_MS = 25000;

function manualFromText(text: string): ManualRef | undefined {
  const m = text.match(/pages?\s+(\d+)(?:\s*(?:to|-|–|and)\s*(\d+))?/i);
  return m ? { page: Number(m[1]), pageEnd: m[2] ? Number(m[2]) : undefined } : undefined;
}

/**
 * Drives the voice overlay from the live voice session.
 *
 * The session listens all the time; the agent only acts after "Hey Cat". The
 * app mirrors that: a transcript starting with the wake phrase (or a tap on a
 * mic button) opens the overlay, and Cat's speaking events move it through
 * thinking -> responding -> done.
 */
export function useVoiceController({
  getScreenContext,
  onExchange,
}: {
  getScreenContext: () => AgentContext | undefined;
  /** A finished voice question + answer, for the chat history. */
  onExchange: (messages: AgentMessage[]) => void;
}) {
  const [voice, setVoiceState] = useState<VoiceSession>(IDLE);
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [connection, setConnection] = useState<VoiceConnection>(voiceService.getConnection());
  const [connectionDetail, setConnectionDetail] = useState<string>();
  const [handsFree, setHandsFree] = useState(false);

  const voiceRef = useRef<VoiceSession>(IDLE);
  /** Finalised transcript pieces of the current question. */
  const committed = useRef('');
  const overlayRef = useRef(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noAnswerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onExchangeRef = useRef(onExchange);
  const screenRef = useRef(getScreenContext);
  useEffect(() => {
    onExchangeRef.current = onExchange;
    screenRef.current = getScreenContext;
  });

  const setVoice = useCallback((next: VoiceSession) => {
    voiceRef.current = next;
    setVoiceState(next);
  }, []);
  const showOverlay = useCallback((visible: boolean) => {
    overlayRef.current = visible;
    setOverlayVisible(visible);
  }, []);
  const clearTimers = useCallback(() => {
    if (doneTimer.current) clearTimeout(doneTimer.current);
    if (noAnswerTimer.current) clearTimeout(noAnswerTimer.current);
    doneTimer.current = noAnswerTimer.current = null;
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    const v = voiceRef.current;
    if (v.phase !== 'responding' && v.phase !== 'thinking') return;
    const question = v.transcript.replace(WAKE_PREFIX, '').trim();
    const answer = v.response;
    setVoice({ ...v, phase: 'done', status: undefined });
    if (question && answer?.text) {
      onExchangeRef.current([
        { id: makeId('MSG'), role: 'operator', text: question, createdAt: nowIso(), mode: 'voice', status: 'sent', context: v.context },
        {
          id: answer.id,
          role: 'agent',
          text: answer.text,
          createdAt: answer.createdAt,
          mode: 'voice',
          status: 'sent',
          citations: answer.citations,
          actions: answer.actions,
          imageUrl: answer.imageUrl,
          manual: answer.manual,
        },
      ]);
    }
    // "Hey Cat, open it": the agent sent manual pages. Show them now the answer is spoken.
    if (v.pages) {
      const p = v.pages;
      showOverlay(false);
      setVoice(IDLE);
      router.push({
        pathname: '/manual',
        params: {
          url: p.url,
          page: String(p.page),
          pageEnd: p.pageEnd ? String(p.pageEnd) : '',
          topic: p.topic ?? '',
          width: String(p.width),
          height: String(p.height),
        },
      });
    }
  }, [clearTimers, setVoice, showOverlay]);

  const handleEvent = useCallback(
    (e: VoiceEvent) => {
      const v = voiceRef.current;
      const active = overlayRef.current && v.phase !== 'idle';
      switch (e.type) {
        case 'connection': {
          setConnection(e.state);
          setConnectionDetail(e.detail);
          if ((e.state === 'error' || e.state === 'unavailable') && active && v.phase !== 'done') {
            clearTimers();
            setVoice({ ...v, phase: 'error', error: e.detail ?? 'Voice is not available.' });
          }
          break;
        }
        case 'user-transcript': {
          const woke = WAKE_PREFIX.test(e.text);
          // After a bare "Hey Cat" Cat says "Yes?" and waits: the next sentence is the question.
          const awaitingQuestion =
            active && (v.phase === 'done' || v.phase === 'responding') && !v.transcript.replace(WAKE_PREFIX, '').trim();
          // Hands-free: "Hey Cat ..." opens the overlay from anywhere.
          if ((woke && (!active || v.phase === 'done' || v.phase === 'error')) || awaitingQuestion) {
            clearTimers();
            committed.current = awaitingQuestion ? v.transcript : '';
            if (e.final) committed.current = `${committed.current} ${e.text}`.trim();
            showOverlay(true);
            setVoice({
              phase: 'listening',
              transcript: e.final ? committed.current : `${committed.current} ${e.text}`.trim(),
              context: screenRef.current() ?? v.context,
            });
            break;
          }
          if (active && (v.phase === 'listening' || v.phase === 'thinking')) {
            // Speech-to-text finalises "Hey, Cat." and the question separately: keep both.
            if (e.final) committed.current = `${committed.current} ${e.text}`.trim();
            const transcript = e.final ? committed.current : `${committed.current} ${e.text}`.trim();
            const hint =
              e.final && !WAKE_PREFIX.test(transcript)
                ? `Cat didn't hear “${voiceService.wakePhrase}”. Start with it, then ask.`
                : undefined;
            setVoice({ ...v, transcript, hint });
          }
          break;
        }
        case 'user-speaking': {
          if (!e.speaking && active && v.phase === 'listening' && WAKE_PREFIX.test(v.transcript)) {
            setVoice({ ...v, phase: 'thinking', hint: undefined });
            noAnswerTimer.current = setTimeout(() => {
              if (voiceRef.current.phase === 'thinking') {
                setVoice({ ...voiceRef.current, phase: 'error', error: 'Cat did not answer. Check the agent server.' });
              }
            }, NO_ANSWER_MS);
          }
          break;
        }
        case 'bot-speaking': {
          if (!active) break; // e.g. the greeting when the session connects
          if (e.speaking) {
            if (doneTimer.current) clearTimeout(doneTimer.current);
            doneTimer.current = null;
            if (v.phase === 'thinking' || v.phase === 'listening' || v.phase === 'responding') {
              if (noAnswerTimer.current) clearTimeout(noAnswerTimer.current);
              setVoice({ ...v, phase: 'responding', hint: undefined });
            }
          } else if (v.phase === 'responding') {
            doneTimer.current = setTimeout(finish, DONE_AFTER_MS);
          }
          break;
        }
        case 'bot-text': {
          if (!active || !['thinking', 'responding', 'listening'].includes(v.phase)) break;
          const filler = FILLERS[e.text.toLowerCase()];
          if (filler) {
            setVoice({ ...v, status: filler });
            break;
          }
          const prev = v.response;
          const text = prev?.text ? `${prev.text} ${e.text}` : e.text;
          const response: AgentResponse = {
            id: prev?.id ?? makeId('VOICE'),
            createdAt: prev?.createdAt ?? nowIso(),
            text,
            citations: [],
            actions: [],
            imageUrl: prev?.imageUrl,
            manual: prev?.manual ?? manualFromText(text),
          };
          setVoice({ ...v, phase: 'responding', response, status: undefined });
          break;
        }
        case 'manual-image': {
          if (!active) break;
          const prev = v.response ?? { id: makeId('VOICE'), createdAt: nowIso(), text: '', citations: [], actions: [] };
          setVoice({
            ...v,
            response: { ...prev, imageUrl: e.url, manual: prev.manual ?? (e.page ? { page: e.page } : undefined) },
          });
          break;
        }
        case 'manual-pages': {
          const pages = { url: e.url, page: e.page, pageEnd: e.pageEnd, topic: e.topic, width: e.width, height: e.height };
          if (active) setVoice({ ...v, pages });
          else
            router.push({
              pathname: '/manual',
              params: { ...pages, page: String(e.page), pageEnd: e.pageEnd ? String(e.pageEnd) : '', topic: e.topic ?? '', width: String(e.width), height: String(e.height) },
            });
          break;
        }
        case 'level':
          break;
      }
    },
    [clearTimers, finish, setVoice, showOverlay],
  );

  useEffect(() => voiceService.subscribe(handleEvent), [handleEvent]);

  // Hands-free listening follows the app: off in the background, back on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!handsFree) return;
      if (state === 'active') voiceService.connect();
      else voiceService.disconnect();
    });
    return () => sub.remove();
  }, [handsFree]);

  const connectVoice = useCallback(() => {
    setHandsFree(true);
    return voiceService.connect();
  }, []);

  const disconnectVoice = useCallback(() => {
    setHandsFree(false);
    return voiceService.disconnect();
  }, []);

  /** Mic button / "Ask Cat about this": open the overlay ready for "Hey Cat, ...". */
  const startVoice = useCallback(
    (context?: AgentContext) => {
      clearTimers();
      const ctx = context ?? screenRef.current();
      if (ctx?.videoId && ctx.timestamp !== undefined) {
        // So "what does this do?" means this frame.
        agentService.reportVideoPause(ctx.videoId, ctx.timestamp).catch(() => undefined);
      }
      committed.current = '';
      showOverlay(true);
      setVoice({
        phase: 'listening',
        transcript: '',
        context: ctx,
        hint: voiceService.live ? `Say “${voiceService.wakePhrase}”, then your question.` : undefined,
      });
      setHandsFree(true);
      voiceService.connect().then(() => {
        if (voiceService.talk) voiceService.talk(ctx);
        else if (!voiceService.live) voiceService.simulateUtterance?.(ctx);
      });
    },
    [clearTimers, setVoice, showOverlay],
  );

  const finishTalking = useCallback(() => voiceService.finishTalking?.(), []);

  const cancelVoice = useCallback(() => {
    clearTimers();
    // Push-to-talk: stop recording / Cat's reply too (the live session keeps listening).
    if (voiceService.pushToTalk) voiceService.disconnect();
    showOverlay(false);
    setVoice(IDLE);
  }, [clearTimers, setVoice, showOverlay]);

  return {
    voice,
    overlayVisible,
    connection,
    connectionDetail,
    handsFree,
    startVoice,
    cancelVoice,
    dismissVoice: cancelVoice,
    connectVoice,
    disconnectVoice,
    voiceIsLive: voiceService.live,
    wakePhrase: voiceService.wakePhrase,
    canSimulate: typeof voiceService.simulateUtterance === 'function',
    pushToTalk: !!voiceService.pushToTalk,
    finishTalking,
    simulateUtterance: (ctx?: AgentContext) => startVoice(ctx),
  };
}
