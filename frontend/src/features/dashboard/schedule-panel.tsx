"use client";

import Link from "next/link";
import { ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { OperatorChip } from "@/components/shared/entity-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { formatTime } from "@/lib/format";
import { taskStatusMeta } from "@/lib/status";
import type { Operator, Task } from "@/lib/types";

interface SchedulePanelProps {
  tasks?: Task[];
  operators?: Operator[];
}

interface OperatorGroup {
  operator: Operator;
  tasks: Task[];
}

/** Per-person run sheet for today — "what is each operator scheduled to do?" */
export function SchedulePanel({ tasks, operators }: SchedulePanelProps) {
  const loading = !tasks || !operators;
  const today = new Date().toDateString();

  const todays = loading
    ? []
    : tasks
        .filter((t) => t.start && new Date(t.start).toDateString() === today)
        .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));

  const operatorLookup = new Map((operators ?? []).map((o) => [o.id, o]));
  const byOperator = new Map<string, Task[]>();
  const unassigned: Task[] = [];

  for (const t of todays) {
    const operator = t.operatorId ? operatorLookup.get(t.operatorId) : undefined;
    if (!operator) {
      unassigned.push(t);
      continue;
    }
    const list = byOperator.get(operator.id) ?? [];
    list.push(t);
    byOperator.set(operator.id, list);
  }

  const groups: OperatorGroup[] = [...byOperator.entries()]
    .map(([id, list]) => ({ operator: operatorLookup.get(id)!, tasks: list }))
    .sort((a, b) => (a.tasks[0]?.start ?? "").localeCompare(b.tasks[0]?.start ?? ""));

  return (
    <SectionCard
      title="Today's schedule"
      subtitle={loading ? undefined : `${todays.length} task${todays.length === 1 ? "" : "s"} · ${groups.length} operator${groups.length === 1 ? "" : "s"} assigned`}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/tasks">
            View calendar <ArrowRight />
          </Link>
        </Button>
      }
      bodyClassName="p-0"
      className="h-full"
    >
      {loading ? (
        <TableSkeleton rows={6} columns={2} />
      ) : todays.length === 0 ? (
        <EmptyState variant="clear" title="Nothing scheduled" description="No tasks start today yet." />
      ) : (
        <ul className="max-h-[420px] divide-y overflow-y-auto">
          {groups.map(({ operator, tasks: opTasks }) => (
            <li key={operator.id} className="px-4 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <OperatorChip operator={operator} size="sm" />
                <span className="shrink-0 text-caption text-muted-foreground">
                  {opTasks.length} task{opTasks.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="flex flex-col gap-1 pl-8">
                {opTasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="flex shrink-0 items-center gap-1 font-mono text-caption text-muted-foreground tabular-nums">
                      <Clock className="size-3" aria-hidden /> {formatTime(t.start!)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-small">
                      {t.title}
                    </span>
                    <StatusBadge meta={taskStatusMeta[t.status]} size="sm" className="shrink-0" />
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {unassigned.length > 0 ? (
            <li className="px-4 py-2.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-small font-medium text-foreground-secondary">Unassigned</span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {unassigned.length} task{unassigned.length === 1 ? "" : "s"}
                </span>
              </div>
              <ul className="flex flex-col gap-1">
                {unassigned.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="flex shrink-0 items-center gap-1 font-mono text-caption text-muted-foreground tabular-nums">
                      <Clock className="size-3" aria-hidden /> {formatTime(t.start!)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-small">
                      {t.title}
                    </span>
                    <StatusBadge meta={taskStatusMeta[t.status]} size="sm" className="shrink-0" />
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      )}
    </SectionCard>
  );
}
