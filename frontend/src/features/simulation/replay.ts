/**
 * Pure functions over a set of timed bars. Everything shown at minute `t` is
 * computed from start_min/end_min alone — no accumulated state — so scrubbing
 * backwards is as exact as playing forwards.
 */

/** One piece of work on one machine with one worker, in minutes from zero. */
export interface Bar {
  id: string | number;
  task_id: string;
  task_type: string;
  worker_id: string;
  machine_id: string;
  machine_type: string;
  start_min: number;
  end_min: number;
}

export type BarState = "pending" | "active" | "done";

export function barState(b: Bar, t: number): BarState {
  if (t < b.start_min) return "pending";
  if (t < b.end_min) return "active";
  return "done";
}

export interface Lane {
  id: string;
  detail: string;
  /** Bars packed into sub-rows, so any overlap stays visible instead of one
   * bar hiding another. Normally one row: a machine does one job at a time. */
  rows: Bar[][];
}

export function buildLanes(bars: Bar[]): Lane[] {
  const groups = new Map<string, { detail: string; items: Bar[] }>();
  for (const b of bars) {
    const g = groups.get(b.machine_id) ?? { detail: b.machine_type, items: [] };
    g.items.push(b);
    groups.set(b.machine_id, g);
  }
  return [...groups.entries()]
    .map(([id, { detail, items }]) => {
      const rows: Bar[][] = [];
      for (const b of [...items].sort((x, y) => x.start_min - y.start_min)) {
        const row = rows.find((r) => r[r.length - 1].end_min <= b.start_min);
        if (row) row.push(b);
        else rows.push([b]);
      }
      return { id, detail, rows };
    })
    .sort((a, b) => a.detail.localeCompare(b.detail) || a.id.localeCompare(b.id));
}
