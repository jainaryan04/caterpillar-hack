import type { AgentContext, AgentResponse, VoiceConnection } from '@/types/agent';
import type { VoiceService } from '../types';
import { createVoiceEvents } from '../voiceEvents';
import { mockVoiceQuestions } from './data/agent';

/**
 * Demo voice session, used in Expo Go and mock mode. It does NOT use the
 * microphone: `simulateUtterance` replays a scripted "Hey Cat, ..." question
 * word by word with fake input levels, gets the answer from the agent service
 * passed in (real Cat over HTTP, or the mock), and "speaks" it sentence by
 * sentence. Same events as the live session, so the UI is identical.
 */
export function createMockVoiceService(
  answer: (question: string, context?: AgentContext) => Promise<AgentResponse>,
  reason: string,
): VoiceService {
  const events = createVoiceEvents();
  let connection: VoiceConnection = 'disconnected';
  let run = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const levels = (source: 'local' | 'remote', ms: number) => {
    const end = Date.now() + ms;
    const tick = () => {
      if (Date.now() > end) return events.emit({ type: 'level', source, level: 0 });
      events.emit({ type: 'level', source, level: 0.3 + Math.random() * 0.6 });
      later(90, tick);
    };
    tick();
  };

  const questionFor = (context?: AgentContext) =>
    context?.videoId || context?.imageUri
      ? mockVoiceQuestions.video
      : context?.taskId
        ? mockVoiceQuestions.task
        : mockVoiceQuestions.general;

  return {
    wakePhrase: 'Hey Cat',
    live: false,
    getConnection: () => connection,
    subscribe: events.subscribe,

    async connect() {
      connection = 'connected';
      events.emit({ type: 'connection', state: 'connected', detail: reason });
    },

    async disconnect() {
      run += 1;
      timers.forEach(clearTimeout);
      timers.clear();
      connection = 'disconnected';
      events.emit({ type: 'connection', state: 'disconnected' });
    },

    simulateUtterance(context) {
      const current = ++run;
      const words = `Hey Cat, ${questionFor(context)}`.split(' ');
      events.emit({ type: 'user-speaking', speaking: true });
      levels('local', words.length * 320 + 200);
      words.forEach((_, i) =>
        later(300 + i * 320, () =>
          events.emit({ type: 'user-transcript', text: words.slice(0, i + 1).join(' '), final: i === words.length - 1 }),
        ),
      );
      later(300 + words.length * 320 + 300, async () => {
        events.emit({ type: 'user-speaking', speaking: false });
        const question = words.slice(2).join(' ');
        try {
          const response = await answer(question, context);
          if (current !== run) return;
          const sentences = response.text.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [response.text];
          events.emit({ type: 'bot-speaking', speaking: true });
          levels('remote', sentences.length * 1400);
          sentences.forEach((s, i) => later(i * 1400, () => current === run && events.emit({ type: 'bot-text', text: s })));
          if (response.imageUrl) events.emit({ type: 'manual-image', url: response.imageUrl, page: response.manual?.page });
          later(sentences.length * 1400, () => current === run && events.emit({ type: 'bot-speaking', speaking: false }));
        } catch (e) {
          events.emit({ type: 'connection', state: 'error', detail: e instanceof Error ? e.message : 'No answer' });
        }
      });
    },
  };
}
