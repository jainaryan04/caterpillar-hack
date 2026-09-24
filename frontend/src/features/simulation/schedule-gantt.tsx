"use client";

import { formatDuration, formatTime } from "@/lib/format";
import type { SimDay, SimTask } from "@/stores/sim-store";
import { SHIFT_MIN, shiftTime } from "./day";

/**
 * The day as a Gantt chart: one row per worker, one bar per task, on real
 * clock times from the start of the shift. The axis always covers the full
 * 12h shift, and stretches past it (with the shift end marked) if the work does.
 */
export function ScheduleGantt({ day }: { day: SimDay }) {
  const end = Math.max(0, ...day.tasks.map((t) => t.end_min));
  const span = Math.max(SHIFT_MIN, Math.ceil(end / 60) * 60);
  const step = span > 16 * 60 ? 180 : 120;
  const ticks: number[] = [];
  for (let m = 0; m <= span; m += step) ticks.push(m);
  const pct = (m: number) => `${(m / span) * 100}%`;
  const at = (m: number) => formatTime(shiftTime(day.date, day.shift, m));

  const rows = new Map<string, SimTask[]>();
  for (const t of day.tasks) rows.set(t.worker_id, [...(rows.get(t.worker_id) ?? []), t]);
  const workers = [...rows.keys()].sort();

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="flex border-b">
          <div className="eyebrow w-24 shrink-0 px-4 py-2">Worker</div>
          <div className="relative h-8 flex-1">
            {ticks.map((m) => (
              <span
                key={m}
                className="absolute top-2 -translate-x-1/2 font-mono text-caption text-muted-foreground tabular-nums first:translate-x-0 last:-translate-x-full"
                style={{ left: pct(m) }}
              >
                {at(m)}
              </span>
            ))}
          </div>
        </div>

        {workers.map((w) => (
          <div key={w} className="flex border-b last:border-b-0">
            <div className="w-24 shrink-0 px-4 py-2 font-mono text-small">{w}</div>
            <div className="relative h-11 flex-1">
              {ticks.map((m) => (
                <span key={m} className="absolute inset-y-0 border-l border-border/60" style={{ left: pct(m) }} aria-hidden />
              ))}
              {span > SHIFT_MIN && (
                <span
                  className="absolute inset-y-0 border-l-2 border-dashed border-warning"
                  style={{ left: pct(SHIFT_MIN) }}
                  title="Shift ends"
                  aria-hidden
                />
              )}
              {rows.get(w)!.map((t) => (
                <div
                  key={t.id}
                  title={`${t.task.task_type} · ${t.worker_id} on ${t.machine_id} · ${at(t.start_min)}–${at(t.end_min)} (${formatDuration(t.predicted_min)})`}
                  className="absolute inset-y-1.5 flex min-w-0 flex-col justify-center overflow-hidden rounded-sm border border-border-strong bg-neutral/35 px-2 leading-tight"
                  style={{ left: pct(t.start_min), width: pct(t.end_min - t.start_min) }}
                >
                  <span className="truncate text-caption font-medium">{t.task.task_type}</span>
                  <span className="truncate font-mono text-[10px] text-foreground-secondary">
                    {t.machine_id} · {at(t.start_min)}–{at(t.end_min)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
