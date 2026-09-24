import type { VoiceEvent } from '@/types/agent';
import type { Unsubscribe } from './types';

/** Small event hub shared by the voice implementations. */
export function createVoiceEvents() {
  const listeners = new Set<(e: VoiceEvent) => void>();
  return {
    emit(event: VoiceEvent) {
      listeners.forEach((l) => l(event));
    },
    subscribe(listener: (e: VoiceEvent) => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** "Hey Cat" / "Hey, Kat." / "Okay cat" at the start of a transcript (mirrors cat_agent/cat/wake_word.py). */
export const WAKE_PREFIX = /^\W*(?:(?:hey|hi|hello|ok|okay)\W*)?[ck]at\b\W*/i;
