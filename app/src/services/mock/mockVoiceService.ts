import type { AgentContext } from '@/types/agent';
import type { Unsubscribe, VoiceService } from '../types';
import { mockVoiceQuestions } from './data/agent';

/**
 * Stand-in for the real speech front-end. It does NOT touch the microphone:
 * it replays a scripted question word by word and emits fake input levels so
 * the listening UI can be built and demoed.
 */

type Listener<T extends unknown[]> = (...args: T) => void;

function channel<T extends unknown[]>() {
  const set = new Set<Listener<T>>();
  return {
    add(l: Listener<T>): Unsubscribe {
      set.add(l);
      return () => {
        set.delete(l);
      };
    },
    emit(...args: T) {
      set.forEach((l) => l(...args));
    },
  };
}

const wake = channel<[]>();
const transcript = channel<[string, boolean]>();
const amplitude = channel<[number]>();
const errors = channel<[string]>();

const WORD_INTERVAL_MS = 320;
const LEAD_IN_MS = 900;
const AMPLITUDE_INTERVAL_MS = 80;

let wordTimer: ReturnType<typeof setTimeout> | null = null;
let ampTimer: ReturnType<typeof setInterval> | null = null;
let words: string[] = [];
let spoken = 0;
let active = false;

function questionFor(context?: AgentContext) {
  if (context?.videoId) return mockVoiceQuestions.video;
  if (context?.taskId) return mockVoiceQuestions.task;
  return mockVoiceQuestions.general;
}

function clearTimers() {
  if (wordTimer) clearTimeout(wordTimer);
  if (ampTimer) clearInterval(ampTimer);
  wordTimer = null;
  ampTimer = null;
}

function finish() {
  if (!active) return;
  active = false;
  clearTimers();
  amplitude.emit(0);
  transcript.emit(words.join(' '), true);
}

function speakNextWord() {
  spoken += 1;
  transcript.emit(words.slice(0, spoken).join(' '), false);
  if (spoken >= words.length) {
    // Short pause after the last word, like end-of-speech detection.
    wordTimer = setTimeout(finish, 700);
  } else {
    wordTimer = setTimeout(speakNextWord, WORD_INTERVAL_MS);
  }
}

export const mockVoiceService: VoiceService = {
  startListening(options) {
    clearTimers();
    active = true;
    words = questionFor(options?.context).split(' ');
    spoken = 0;
    let t = 0;
    ampTimer = setInterval(() => {
      t += 1;
      const speaking = spoken > 0 && spoken < words.length + 1;
      // Speech-like envelope: syllable bumps on top of a noise floor.
      const syllable = Math.abs(Math.sin(t * 1.7)) * 0.6 + Math.random() * 0.4;
      amplitude.emit(speaking ? Math.min(1, 0.25 + syllable * 0.75) : 0.06 + Math.random() * 0.06);
    }, AMPLITUDE_INTERVAL_MS);
    wordTimer = setTimeout(speakNextWord, LEAD_IN_MS);
  },

  stopListening() {
    if (!active) return;
    // Finalise with whatever has been "heard" so far (at least the full phrase
    // if nothing was captured yet, so the demo always produces a question).
    if (spoken === 0) spoken = words.length;
    words = words.slice(0, Math.max(spoken, 1));
    finish();
  },

  cancel() {
    active = false;
    clearTimers();
    amplitude.emit(0);
  },

  onWakeWordDetected: wake.add,
  onTranscript: transcript.add,
  onAmplitude: amplitude.add,
  onError: errors.add,

  simulateWakeWord() {
    wake.emit();
  },
};
