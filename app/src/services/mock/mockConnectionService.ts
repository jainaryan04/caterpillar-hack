import type { ConnectionService, ConnectionState } from '../types';
import { mockConfig } from './mockConfig';

let state: ConnectionState = mockConfig.startOffline ? 'offline' : 'online';
const listeners = new Set<(s: ConnectionState) => void>();

export const mockConnectionService: ConnectionService & {
  /** Dev helper to demo the offline banner. */
  setState(next: ConnectionState): void;
} = {
  getState: () => state,
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setState(next) {
    state = next;
    listeners.forEach((l) => l(state));
  },
};
