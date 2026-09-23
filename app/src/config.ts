/**
 * Where the backends live. Set in app/.env (see .env.example); Expo inlines
 * EXPO_PUBLIC_* variables at bundle time.
 */
const trimSlash = (url: string) => url.replace(/\/+$/, '');

export const config = {
  /** Fleet Scheduler API (Prediction/): tasks, assignments, workers. */
  fleetApiUrl: trimSlash(process.env.EXPO_PUBLIC_FLEET_API_URL ?? 'http://10.0.2.2:8000'),
  /** Cat agent (cat_agent/): questions, photos, training videos. */
  catApiUrl: trimSlash(process.env.EXPO_PUBLIC_CAT_API_URL ?? 'http://10.0.2.2:8765'),
  /** Use the built-in mock data instead of either server. */
  useMocks: process.env.EXPO_PUBLIC_USE_MOCKS === '1',
};
