import type { AgentAction } from '@/types/agent';

/**
 * Tiny pub/sub so screens can react to agent actions that target them
 * (e.g. the video screen listens for PAUSE_VIDEO / RESUME_VIDEO).
 */
type Listener = (action: AgentAction) => void;
const listeners = new Set<Listener>();

export const agentActionBus = {
  emit(action: AgentAction) {
    listeners.forEach((l) => l(action));
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
