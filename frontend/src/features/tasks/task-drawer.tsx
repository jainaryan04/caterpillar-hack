"use client";

import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComplexityPips } from "@/components/shared/complexity-pips";
import { MachineChip, OperatorChip } from "@/components/shared/entity-chip";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { DetailList, DrawerSection, RightDrawer } from "@/components/shared/right-drawer";
import { StatusBadge } from "@/components/shared/status-badge";
import { addMinutes, formatDate, formatDuration, formatTime } from "@/lib/format";
import { complexityLabel, taskStatusMeta, taskTypeIcon } from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Task } from "@/lib/types";

interface TaskDrawerProps {
  task: Task | undefined;
  lookup: EntityLookup;
  onClose: () => void;
  onComplete: (task: Task) => void;
  completing?: boolean;
}

/** No "edit" action: the backend has no route that changes a task's own
 * fields once created, only ones that mark a scheduled portion started/done
 * (PATCH /v1/assignments/{id}, wired to onComplete below) or re-run the
 * whole plan (the "Replan" button on the Tasks page). */
export function TaskDrawer({ task, lookup, onClose, onComplete, completing }: TaskDrawerProps) {
  const machine = lookup.machine(task?.machineId);
  const operator = lookup.operator(task?.operatorId);
  const zone = lookup.zone(task?.zoneId);
  const TypeIcon = task ? taskTypeIcon(task.type) : null;
  const closed = task?.status === "completed" || task?.status === "cancelled";

  return (
    <RightDrawer
      open={Boolean(task)}
      onOpenChange={(o) => !o && onClose()}
      title={task?.title ?? ""}
      subtitle={
        task ? (
          <span className="flex items-center gap-1.5">
            {TypeIcon ? <TypeIcon className="size-4" aria-hidden /> : null}
            <span className="font-mono">{task.id}</span> · {task.type}
          </span>
        ) : undefined
      }
      meta={
        task ? (
          <>
            <StatusBadge meta={taskStatusMeta[task.status]} />
            <span className="flex items-center gap-1.5 text-caption text-foreground-secondary">
              <ComplexityPips complexity={task.complexity} /> {complexityLabel[task.complexity]} complexity
            </span>
          </>
        ) : undefined
      }
      footer={
        task ? (
          <>
            {!closed && /^\d+$/.test(task.id) ? (
              <Button onClick={() => onComplete(task)} disabled={completing}>
                {completing ? <Loader2 className="animate-spin" /> : <CircleCheck />} Mark complete
              </Button>
            ) : !closed ? (
              <p className="text-caption text-muted-foreground">
                Not yet in the published plan — nothing to mark complete.
              </p>
            ) : null}
          </>
        ) : undefined
      }
    >
      {task ? (
        <div className="flex flex-col divide-y">
          {task.status === "delayed" ? (
            <div className="mb-3 flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-small">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div>
                <p className="font-medium">Running behind schedule</p>
                {task.notes ? <p className="text-foreground-secondary">{task.notes}</p> : null}
              </div>
            </div>
          ) : null}

          <DrawerSection title="Schedule">
            <DetailList
              items={[
                { label: "Date", value: task.start ? formatDate(task.start) : "Unscheduled" },
                {
                  label: "Time",
                  value: task.start ? (
                    <span className="tabular-nums">
                      {formatTime(task.start)}–{formatTime(addMinutes(task.start, task.durationMin))}
                    </span>
                  ) : (
                    "—"
                  ),
                },
                { label: "Duration", value: formatDuration(task.durationMin) },
                { label: "Zone", value: zone?.name ?? "—" },
              ]}
            />
          </DrawerSection>

          <DrawerSection title="Machine">
            {machine ? <MachineChip machine={machine} /> : <p className="text-small text-muted-foreground">No machine assigned</p>}
          </DrawerSection>

          <DrawerSection title="Operator">
            {operator ? (
              <div className="flex items-center justify-between gap-3">
                <OperatorChip operator={operator} />
                <FatigueIndicator score={operator.fatigue} showLabel />
              </div>
            ) : (
              <p className="text-small text-muted-foreground">No operator assigned</p>
            )}
          </DrawerSection>

          {task.notes && task.status !== "delayed" ? (
            <DrawerSection title="Notes">
              <p className="text-small text-foreground-secondary">{task.notes}</p>
            </DrawerSection>
          ) : null}
        </div>
      ) : null}
    </RightDrawer>
  );
}
