"use client";

import { memo } from "react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { barState, type BarState, type Lane } from "./replay";

const ROW_H = 22;
const LANE_PAD = 6;

const barClass: Record<BarState, string> = {
  // Outline only: not started. Solid: running now. Muted fill: finished.
  pending: "border border-dashed border-border-strong bg-transparent text-muted-foreground",
  active: "border border-success bg-success/85 text-background font-semibold",
  done: "border border-transparent bg-neutral/35 text-foreground-secondary",
};

function ticks(makespan: number) {
  const hours = makespan / 60;
  const step = hours > 48 ? 12 : hours > 24 ? 6 : hours > 8 ? 2 : 1;
  const out: number[] = [];
  for (let h = 0; h * 60 <= makespan; h += step) out.push(h * 60);
  return out;
}

interface ResourceLanesProps {
  lanes: Lane[];
  makespan: number;
  t: number;
  onSeek: (minute: number) => void;
}

/**
 * One row per machine, bars at each task's start/end minute. Work happening
 * at the same time sits at the same x on different rows. Clicking a bar
 * jumps playback to its start.
 */
export const ResourceLanes = memo(function ResourceLanes({ lanes, makespan, t, onSeek }: ResourceLanesProps) {
  const pct = (m: number) => `${(100 * m) / makespan}%`;

  return (
    <div className="max-h-[560px] overflow-auto" role="figure" aria-label="Schedule by resource">
      <div className="min-w-[640px]">
        {/* Axis */}
        <div className="sticky top-0 z-20 flex border-b bg-panel">
          <div className="w-32 shrink-0 px-3 py-1.5 eyebrow">Resource</div>
          <div className="relative h-6 flex-1">
            {ticks(makespan).map((m) => (
              <span
                key={m}
                className="absolute top-1.5 -translate-x-1/2 font-mono text-[10px] leading-tight text-muted-foreground tabular-nums first:translate-x-0"
                style={{ left: pct(m) }}
              >
                +{Math.round(m / 60)}h
              </span>
            ))}
          </div>
        </div>

        <div className="flex">
          {/* Labels */}
          <div className="w-32 shrink-0 border-r">
            {lanes.map((l) => (
              <div
                key={l.id}
                className="flex flex-col justify-center border-b px-3 leading-tight"
                style={{ height: l.rows.length * ROW_H + LANE_PAD }}
              >
                <span className="font-mono text-caption">{l.id}</span>
                {l.detail ? <span className="truncate text-[10px] text-muted-foreground">{l.detail}</span> : null}
              </div>
            ))}
          </div>

          {/* Tracks + playhead */}
          <div className="relative flex-1">
            {lanes.map((l) => (
              <div key={l.id} className="relative border-b" style={{ height: l.rows.length * ROW_H + LANE_PAD }}>
                {l.rows.map((row, ri) =>
                  row.map((p) => {
                    const state = barState(p, t);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onSeek(p.start_min)}
                        title={`${p.task_type} · ${p.worker_id} on ${p.machine_id} · +${formatDuration(p.start_min)} → +${formatDuration(p.end_min)}`}
                        className={cn(
                          "absolute flex items-center overflow-hidden rounded-[3px] px-1 text-left font-mono text-[10px] leading-none whitespace-nowrap",
                          barClass[state],
                        )}
                        style={{
                          left: pct(p.start_min),
                          width: `max(3px, ${pct(p.end_min - p.start_min)})`,
                          top: LANE_PAD / 2 + ri * ROW_H + 2,
                          height: ROW_H - 4,
                        }}
                      >
                        {p.task_type}
                      </button>
                    );
                  }),
                )}
              </div>
            ))}
            <div
              className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground"
              style={{ left: pct(t) }}
              aria-hidden
            />
          </div>
        </div>
      </div>
    </div>
  );
});
