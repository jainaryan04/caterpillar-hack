"use client";

import { SectionCard } from "@/components/shared/section-card";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { formatTime } from "@/lib/format";
import { severityMeta, toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { SafetyAlert, Task } from "@/lib/types";

interface Entry {
  key: string;
  at: string;
  actor: string;
  text: string;
  dot: string;
}

/** Chronological feed of event timeline entries and task milestones. */
export function RecentActivity({ alerts, tasks }: { alerts?: SafetyAlert[]; tasks?: Task[] }) {
  const today = new Date().toDateString();
  const entries: Entry[] = [
    ...(alerts ?? []).flatMap((a) =>
      a.timeline.map((t, i) => ({
        key: `${a.id}-${i}`,
        at: t.at,
        actor: t.actor,
        text: `${t.action} — ${a.title}`,
        dot: toneClasses[severityMeta[a.severity].tone].solid,
      })),
    ),
    ...(tasks ?? [])
      .filter((t) => t.start && t.status !== "scheduled" && t.status !== "cancelled")
      .map((t) => ({
        key: `${t.id}-start`,
        at: t.start!,
        actor: t.machineId ?? "Crew",
        text: `Started ${t.id} · ${t.title}`,
        dot: "bg-foreground-secondary",
      })),
  ]
    .filter((e) => new Date(e.at).toDateString() === today)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 9);

  return (
    <SectionCard title="Recent activity" subtitle="Today" className="h-full" bodyClassName="px-4 py-2">
      {!alerts || !tasks ? (
        <TableSkeleton rows={6} columns={2} />
      ) : (
        <ol className="relative flex flex-col">
          {entries.map((e, i) => (
            <li key={e.key} className="relative flex gap-3 py-2">
              {i < entries.length - 1 ? (
                <span className="absolute top-5 bottom-[-0.5rem] left-[3px] w-px bg-border" aria-hidden />
              ) : null}
              <span className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", e.dot)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-small">{e.text}</p>
                <p className="text-caption text-muted-foreground">
                  <span className="font-mono tabular-nums">{formatTime(e.at)}</span> · {e.actor}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
