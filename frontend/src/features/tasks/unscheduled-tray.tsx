"use client";

import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplexityPips } from "@/components/shared/complexity-pips";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDuration } from "@/lib/format";
import { taskTypeIcon } from "@/lib/status";
import type { Task } from "@/lib/types";

interface UnscheduledTrayProps {
  tasks: Task[];
  onOpen: (id: string) => void;
  onSchedule: (task: Task) => void;
}

/** Backlog of tasks with no start time — spec §5.2. */
export function UnscheduledTray({ tasks, onOpen, onSchedule }: UnscheduledTrayProps) {
  return (
    <aside className="flex min-h-0 flex-col rounded-lg border bg-panel" aria-label="Unscheduled tasks">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <h2 className="text-h3">Unscheduled</h2>
        <span className="rounded-sm bg-raised px-1.5 font-mono text-caption tabular-nums text-foreground-secondary">
          {tasks.length}
        </span>
      </div>
      {tasks.length === 0 ? (
        <EmptyState variant="clear" title="Everything's scheduled" className="py-8" />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {tasks.map((t) => {
            const Icon = taskTypeIcon(t.type);
            return (
              <li key={t.id} className="rounded-md border bg-raised/40 hover:border-border-strong">
                <button type="button" onClick={() => onOpen(t.id)} className="flex w-full flex-col gap-1 p-2.5 text-left">
                  <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden />
                    <span className="font-mono">{t.id}</span>
                    <span>· {t.type}</span>
                    <ComplexityPips complexity={t.complexity} className="ml-auto" />
                  </span>
                  <span className="text-small font-medium">{t.title}</span>
                  <span className="text-caption text-muted-foreground">Est. {formatDuration(t.durationMin)}</span>
                </button>
                <div className="border-t px-2.5 py-1.5">
                  <Button variant="ghost" size="xs" onClick={() => onSchedule(t)} className="-ml-1.5">
                    <CalendarPlus /> Schedule
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
