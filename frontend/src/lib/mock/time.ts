/**
 * Mock timestamps are anchored to "today" so the calendar and shift views
 * always show data. Values are whole minutes, which keeps server and client
 * renders identical within the same day.
 */
export function at(dayOffset: number, hours: number, minutes = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

/** Deterministic pseudo-noise in [0, 1) — avoids Math.random() hydration mismatches. */
export function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
