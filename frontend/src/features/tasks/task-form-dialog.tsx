"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { addMinutes, formatDuration, formatTime } from "@/lib/format";
import { FATIGUE } from "@/lib/mock/operators";
import { TASK_TYPES } from "@/lib/mock/tasks";
import {
  availabilityMeta,
  complexityLabel,
  machineStatusMeta,
  taskMachineTypes,
  taskStatusMeta,
  taskTypeLabel,
} from "@/lib/status";
import type { Machine, Operator, Task, TaskComplexity, TaskStatus, TaskType, Zone } from "@/lib/types";

const NONE = "none";

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** Prefill: an existing task (edit) or a partial draft (create from calendar selection) */
  initial?: Partial<Task>;
  nextId: string;
  machines: Machine[];
  operators: Operator[];
  zones: Zone[];
  onSubmit: (task: Task) => void;
}

function Field({ label, htmlFor, children, hint, error }: { label: string; htmlFor?: string; children: ReactNode; hint?: ReactNode; error?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-small text-foreground-secondary">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-caption text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <div className="text-caption">{hint}</div>
      ) : null}
    </div>
  );
}

/** Create / edit task — spec §5.2 field order and inline warnings. */
export function TaskFormDialog({
  open,
  onOpenChange,
  mode,
  initial,
  nextId,
  machines,
  operators,
  zones,
  onSubmit,
}: TaskFormDialogProps) {
  const startDate = initial?.start ? new Date(initial.start) : null;

  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<TaskType>(initial?.type ?? "hauling");
  const [complexity, setComplexity] = useState<TaskComplexity>(initial?.complexity ?? "medium");
  const [machineId, setMachineId] = useState(initial?.machineId ?? NONE);
  const [operatorId, setOperatorId] = useState(initial?.operatorId ?? NONE);
  const [date, setDate] = useState(startDate ? toDateInput(startDate) : "");
  const [time, setTime] = useState(startDate ? toTimeInput(startDate) : "");
  const [duration, setDuration] = useState(initial?.durationMin ?? 120);
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? "scheduled");
  const [zoneId, setZoneId] = useState(initial?.zoneId ?? zones[0]?.id ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const allowed = taskMachineTypes[type];
  const machineOptions = useMemo(
    () => machines.filter((m) => allowed === "any" || allowed.includes(m.type)),
    [machines, allowed],
  );
  const operatorOptions = useMemo(
    () => operators.filter((o) => o.availability !== "leave"),
    [operators],
  );

  const operator = operators.find((o) => o.id === operatorId);
  const zone = zones.find((z) => z.id === zoneId);
  const start = date && time ? new Date(`${date}T${time}`) : null;
  const end = start ? new Date(addMinutes(start.toISOString(), duration)) : null;

  const operatorWarnings: string[] = [];
  if (operator && operator.fatigue >= FATIGUE.high) operatorWarnings.push(`Fatigue ${operator.fatigue} — high`);
  if (operator && complexity === "high" && machineId !== NONE) {
    const m = machines.find((x) => x.id === machineId);
    if (m && !operator.certifications.includes(m.type)) operatorWarnings.push("Not certified for this machine type");
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!title.trim()) next.title = "Enter a task title.";
    if (duration < 15) next.duration = "Duration must be at least 15 minutes.";
    if ((date && !time) || (!date && time)) next.start = "Set both a date and a start time, or leave both empty.";
    setErrors(next);
    if (Object.keys(next).length) return;

    onSubmit({
      id: initial?.id ?? nextId,
      title: title.trim(),
      type,
      complexity,
      machineId: machineId === NONE ? null : machineId,
      operatorId: operatorId === NONE ? null : operatorId,
      start: start ? start.toISOString() : null,
      durationMin: duration,
      status,
      zoneId,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden bg-panel p-0 sm:max-w-2xl">
        <form onSubmit={submit} className="flex max-h-[90dvh] flex-col" noValidate>
          <DialogHeader className="border-b p-5">
            <DialogTitle className="text-h2">{mode === "create" ? "New task" : `Edit ${initial?.id}`}</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Schedule work for a machine and operator. Leave the start empty to add it to the backlog."
                : "Change the assignment, timing or status."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Title" htmlFor="task-title" error={errors.title}>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Bench 4 face excavation"
                  aria-invalid={Boolean(errors.title)}
                  autoFocus
                />
              </Field>
            </div>

            <Field label="Task type">
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as TaskType);
                  setMachineId(NONE);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {taskTypeLabel[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Complexity">
              <SegmentedControl
                ariaLabel="Complexity"
                value={complexity}
                onChange={setComplexity}
                options={(["low", "medium", "high"] as const).map((c) => ({ value: c, label: complexityLabel[c] }))}
                className="w-full [&>*]:flex-1"
              />
            </Field>

            <Field
              label="Machine"
              hint={
                allowed !== "any" ? (
                  <span className="text-muted-foreground">Showing machines that can do {taskTypeLabel[type].toLowerCase()}.</span>
                ) : undefined
              }
            >
              <Select value={machineId} onValueChange={setMachineId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {machineOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={m.status === "offline"}>
                      <span className="font-mono">{m.id}</span>
                      <span className="text-muted-foreground">
                        {m.model.replace("Cat ", "")} · {machineStatusMeta[m.status].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Operator"
              hint={
                operatorWarnings.length ? (
                  <span className="flex flex-col gap-0.5">
                    {operatorWarnings.map((w) => (
                      <span key={w} className="flex items-center gap-1 text-warning">
                        <TriangleAlert className="size-3.5" /> {w}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
            >
              <Select value={operatorId} onValueChange={setOperatorId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {operatorOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                      <span className="text-muted-foreground">
                        {availabilityMeta[o.availability].label} · fatigue {o.fatigue}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Start" error={errors.start}>
              <div className="flex gap-2">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Start date" className="flex-1" />
                <Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Start time" className="w-28" />
              </div>
            </Field>

            <Field
              label="Duration (minutes)"
              htmlFor="task-duration"
              error={errors.duration}
              hint={
                end ? (
                  <span className="text-muted-foreground tabular-nums">
                    {formatDuration(duration)} · ends {formatTime(end)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{formatDuration(duration)}</span>
                )
              }
            >
              <Input
                id="task-duration"
                type="number"
                min={15}
                step={15}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                aria-invalid={Boolean(errors.duration)}
                className="tabular-nums"
              />
            </Field>

            <Field
              label="Zone"
              hint={
                zone?.kind === "restricted" ? (
                  <span className="flex items-center gap-1 text-danger">
                    <OctagonAlert className="size-3.5" /> Restricted zone{zone.activeWindow ? ` — active ${zone.activeWindow}` : ""}
                  </span>
                ) : undefined
              }
            >
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                      {z.kind === "restricted" ? <span className="text-danger">Restricted</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)} disabled={mode === "create"}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(taskStatusMeta) as TaskStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {taskStatusMeta[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="sm:col-span-2">
              <Field label="Notes" htmlFor="task-notes">
                <Textarea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" />
              </Field>
            </div>
          </div>

          <DialogFooter className="m-0 border-t bg-panel p-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{mode === "create" ? "Create task" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
