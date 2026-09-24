"use client";

import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MachineChip } from "@/components/shared/entity-chip";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { DetailList, DrawerSection, RightDrawer } from "@/components/shared/right-drawer";
import { ShiftProgress } from "@/components/shared/shift-progress";
import { Sparkline } from "@/components/shared/sparkline";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatTime } from "@/lib/format";
import { useRunWorkers, useWorkerState } from "@/hooks/use-fleet-data";
import {
  availabilityMeta,
  fatigueTone,
  machineStatusMeta,
  machineTypeLabel,
  taskStatusMeta,
  toneClasses,
} from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Operator, Task } from "@/lib/types";

interface OperatorDrawerProps {
  operator: Operator | undefined;
  tasks: Task[];
  lookup: EntityLookup;
  onClose: () => void;
}

/** Operator profile quick-look — spec §5.3 detail. */
export function OperatorDrawer({ operator: o, tasks, lookup, onClose }: OperatorDrawerProps) {
  const machine = lookup.machine(o?.machineId);
  const { data: stateSamples } = useWorkerState();
  const { data: runWorkers } = useRunWorkers();

  const assigned = o
    ? tasks
        .filter((t) => t.operatorId === o.id && t.start)
        .sort((a, b) => a.start!.localeCompare(b.start!))
        .filter((t) => new Date(t.start!).toDateString() === new Date().toDateString())
    : [];

  // The real fatigue curve the scheduling engine projected for this operator
  // across the published plan. There is no multi-day fatigue history in the
  // backend, so this is the plan horizon, not "the last 14 days".
  const trend = o
    ? (stateSamples ?? [])
        .filter((s) => s.resource_id === o.id)
        .sort((a, b) => a.t_min - b.t_min)
        .map((s) => s.value)
    : [];
  const usage = o ? runWorkers?.find((w) => w.worker_id === o.id) : undefined;

  return (
    <RightDrawer
      open={Boolean(o)}
      onOpenChange={(open) => !open && onClose()}
      title={
        o ? (
          <span className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback className="bg-raised text-small font-semibold">{o.initials}</AvatarFallback>
            </Avatar>
            <span className="flex flex-col leading-tight">
              <span className="font-mono">{o.id}</span>
              <span className="text-caption font-normal text-muted-foreground">
                Skill {o.skillLevel}/10 · {o.skills.length} certified task types
              </span>
            </span>
          </span>
        ) : (
          ""
        )
      }
      meta={o ? <StatusBadge meta={availabilityMeta[o.availability]} /> : undefined}
      footer={
        o ? (
          <>
            <Button asChild>
              <Link href="/tasks">
                <CalendarPlus /> Assign task
              </Link>
            </Button>
          </>
        ) : undefined
      }
    >
      {o ? (
        <div className="flex flex-col divide-y">
          <DrawerSection title="Availability window">
            <ShiftProgress shift={o.shift} hoursWorked={o.hoursWorked} plannedHours={o.plannedHours} />
            <DetailList
              items={[
                {
                  label: "Skill level",
                  value: <span className="font-mono tabular-nums">{o.skillLevel} / 10</span>,
                },
                {
                  label: "In this plan",
                  value: usage ? (
                    <span className="tabular-nums">
                      {usage.n_tasks} {usage.n_tasks === 1 ? "portion" : "portions"} ·{" "}
                      {usage.utilization_pct}% utilised
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not scheduled</span>
                  ),
                },
              ]}
            />
          </DrawerSection>

          <DrawerSection title="Fatigue">
            <div className="flex items-center justify-between gap-4">
              <FatigueIndicator score={o.fatigue} showLabel />
              {trend.length > 1 ? (
                <span className="flex items-center gap-2 text-caption text-muted-foreground">
                  Across plan
                  <Sparkline data={trend} className={cn("w-24", toneClasses[fatigueTone(o.fatigue)].text)} />
                </span>
              ) : null}
            </div>
            {usage ? (
              <ul className="grid grid-cols-3 gap-2 text-caption">
                <li className="rounded-md bg-raised p-2">
                  <span className="block text-muted-foreground">Start of plan</span>
                  <span className="font-mono text-small">{usage.start_fatigue}</span>
                </li>
                <li className="rounded-md bg-raised p-2">
                  <span className="block text-muted-foreground">Peak</span>
                  <span className={cn("font-mono text-small", toneClasses[fatigueTone(usage.peak_fatigue)].text)}>
                    {usage.peak_fatigue}
                  </span>
                </li>
                <li className="rounded-md bg-raised p-2">
                  <span className="block text-muted-foreground">End of plan</span>
                  <span className="font-mono text-small">{usage.end_fatigue}</span>
                </li>
              </ul>
            ) : (
              <p className="text-small text-muted-foreground">
                No fatigue projection — this operator has no work in the published plan.
              </p>
            )}
          </DrawerSection>

          <DrawerSection title="Current machine">
            {machine ? (
              <div className="flex items-center justify-between gap-3">
                <MachineChip machine={machine} />
                <StatusBadge meta={machineStatusMeta[machine.status]} size="sm" />
              </div>
            ) : (
              <p className="text-small text-muted-foreground">Not assigned to a machine</p>
            )}
          </DrawerSection>

          <DrawerSection title={`Today's tasks (${assigned.length})`}>
            {assigned.length ? (
              <ul className="flex flex-col gap-1.5">
                {assigned.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/tasks?task=${t.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:border-border-strong"
                    >
                      <span className="flex min-w-0 flex-col leading-tight">
                        <span className="truncate text-small font-medium">{t.title}</span>
                        <span className="font-mono text-caption text-muted-foreground">
                          {t.id} · {formatTime(t.start!)}
                        </span>
                      </span>
                      <StatusBadge meta={taskStatusMeta[t.status]} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted-foreground">No tasks today</p>
            )}
          </DrawerSection>

          <DrawerSection title="Certifications">
            <ul className="flex flex-wrap gap-1.5">
              {o.certifications.map((c) => (
                <li key={c} className="rounded-sm border bg-raised px-2 py-0.5 text-caption">
                  {machineTypeLabel[c]}
                </li>
              ))}
            </ul>
          </DrawerSection>
        </div>
      ) : null}
    </RightDrawer>
  );
}
