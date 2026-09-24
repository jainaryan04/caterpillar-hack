/**
 * Knobs for demoing states without a backend. Flip these while developing to
 * see loading, error and offline UI.
 */
export const mockConfig = {
  /** Simulated network latency for data calls. */
  latencyMs: 450,
  /** Simulated agent "thinking" time. */
  agentLatencyMs: 1400,
  /** Simulated image analysis time. */
  imageAnalysisMs: 2600,
  /** Make every data call fail, to see error states. */
  failRequests: false,
  /** Start the app in the offline state. */
  startOffline: false,
};

export class MockNetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'MockNetworkError';
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits like a network call and optionally fails, per mockConfig. */
export async function simulateRequest(ms = mockConfig.latencyMs): Promise<void> {
  await delay(ms);
  if (mockConfig.failRequests) throw new MockNetworkError();
}

/** Callers get copies so they can't mutate the mock "database". */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
