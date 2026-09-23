"use client";

import Link from "next/link";
import { CalendarPlus, Phone } from "lucide-react";
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
import { noise } from "@/lib/mock/time";
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

const WEEKLY_LIMIT = 60;

interface OperatorDrawerProps {
  operator: Operator | undefined;
  tasks: Task[];
  lookup: EntityLookup;
  onClose: () => void;
}

/** Operator profile quick-look — spec §5.3 detail. */
export function OperatorDrawer({ operator: o, tasks, lookup, onClose }: OperatorDrawerProps) {
  const machine = lookup.machine(o?.machineId);
  const assigned = o
    ? tasks
        .filter((t) => t.operatorId === o.id && t.start)
        .sort((a, b) => a.start!.localeCompare(b.start!))
        .filter((t) => new Date(t.start!).toDateString() === new Date().toDateString())
    : [];
  const seed = o ? Number(o.id.slice(-3)) : 0;
  const trend = o
    ? Array.from({ length: 14 }, (_, i) => Math.max(0, Math.round(o.fatigue - 18 + i * 1.3 + noise(seed + i) * 12)))
    : [];

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
              {o.name}
              <span className="font-mono text-caption font-normal text-muted-foreground">
                {o.id} · {o.role}
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
            <Button asChild variant="secondary">
              <a href={`tel:${o.phone.replace(/\s/g, "")}`}>
                <Phone /> Call
              </a>
            </Button>
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
          <DrawerSection title="Current shift">
            <ShiftProgress shift={o.shift} hoursWorked={o.hoursWorked} plannedHours={o.plannedHours} />
            <DetailList
              items={[
                {
                  label: "This week",
                  value: (
                    <span className={cn("tabular-nums", o.hoursThisWeek >= WEEKLY_LIMIT * 0.9 && "text-warning")}>
                      {o.hoursThisWeek} / {WEEKLY_LIMIT} h site limit
                    </span>
                  ),
                },
                { label: "Phone", value: <span className="font-mono">{o.phone}</span> },
              ]}
            />
          </DrawerSection>

          <DrawerSection title="Fatigue">
            <div className="flex items-center justify-between gap-4">
              <FatigueIndicator score={o.fatigue} showLabel />
              <span className="flex items-center gap-2 text-caption text-muted-foreground">
                14 days
                <Sparkline data={trend} className={cn("w-24", toneClasses[fatigueTone(o.fatigue)].text)} />
              </span>
            </div>
            <ul className="grid grid-cols-3 gap-2 text-caption">
              <li className="rounded-md bg-raised p-2">
                <span className="block text-muted-foreground">Hours this shift</span>
                <span className="font-mono text-small">{o.hoursWorked.toFixed(1)}</span>
              </li>
              <li className="rounded-md bg-raised p-2">
                <span className="block text-muted-foreground">Consecutive shifts</span>
                <span className="font-mono text-small">{Math.min(7, Math.round(o.hoursThisWeek / 11))}</span>
              </li>
              <li className="rounded-md bg-raised p-2">
                <span className="block text-muted-foreground">Night shifts (wk)</span>
                <span className="font-mono text-small">{o.shift?.name === "Night" ? 3 : 0}</span>
              </li>
            </ul>
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
