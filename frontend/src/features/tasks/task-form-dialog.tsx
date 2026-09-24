"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
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
import { taskTypeLabel, TASK_TYPE_MACHINE, TASK_TYPE_QUANTITY } from "@/lib/status";
import type { TaskType } from "@/lib/types";
import type { CreateTaskInput } from "@/lib/api/client";

const MINING_TASK_TYPES: TaskType[] = ["excavation", "hauling", "loading", "drilling"];
const WEATHER: CreateTaskInput["weather"][] = ["Sunny", "Cloudy", "Rainy"];
const SHIFTS: CreateTaskInput["shiftType"][] = ["Day", "Night"];
const PRIORITIES = [1, 2, 3, 4] as const;

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-small text-foreground-secondary">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-caption text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface TaskFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateTaskInput) => void;
  submitting?: boolean;
}

/**
 * New task. Fields are exactly what the real scheduler needs (task type,
 * priority, quantity, weather, shift) -- not a title, machine, operator, start
 * time or duration, because none of those are inputs in this system: the ML
 * model predicts duration and the solver picks the machine/operator/start
 * once this task joins the next plan. There is no "edit" mode: the backend
 * has no endpoint that changes a task's own fields after creation, only ones
 * that mark a scheduled portion started/done (see TaskDrawer).
 */
export function TaskFormDialog({ open, onOpenChange, onSubmit, submitting }: TaskFormDialogProps) {
  const [type, setType] = useState<TaskType>("excavation");
  const [priority, setPriority] = useState(2);
  const [weather, setWeather] = useState<CreateTaskInput["weather"]>("Sunny");
  const [shiftType, setShiftType] = useState<CreateTaskInput["shiftType"]>("Day");

  const range = TASK_TYPE_QUANTITY[type];
  const [quantity, setQuantity] = useState(range.default);
  const [error, setError] = useState<string | null>(null);

  const machineHint = useMemo(() => `Needs a ${TASK_TYPE_MACHINE[type]}`, [type]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    setError(null);
    onSubmit({ type, priority, quantity, weather, shiftType });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-0 overflow-hidden bg-panel p-0 sm:max-w-lg">
        <form onSubmit={submit} className="flex max-h-[90dvh] flex-col" noValidate>
          <DialogHeader className="border-b p-5">
            <DialogTitle className="text-h2">New task</DialogTitle>
            <DialogDescription>
              Added to the roster and included in the next plan. The scheduler predicts its duration and
              assigns the machine, operator and start time — those are not set here.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Task type" hint={machineHint}>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    const t = v as TaskType;
                    setType(t);
                    setQuantity(TASK_TYPE_QUANTITY[t].default);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MINING_TASK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {taskTypeLabel[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Priority" hint="Stage within the industry — lower runs first">
              <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={String(p)}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label={`Quantity (${range.unit})`}
              htmlFor="task-quantity"
              hint={`Typical range for this site: ${range.min}–${range.max} ${range.unit}`}
            >
              <Input
                id="task-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                aria-invalid={Boolean(error)}
                className="tabular-nums"
              />
              {error ? (
                <p className="text-caption text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </Field>

            <Field label="Weather">
              <Select value={weather} onValueChange={(v) => setWeather(v as CreateTaskInput["weather"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEATHER.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Shift">
              <Select value={shiftType} onValueChange={(v) => setShiftType(v as CreateTaskInput["shiftType"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHIFTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter className="m-0 border-t bg-panel p-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "Scheduling…" : "Create & schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
