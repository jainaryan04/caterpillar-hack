"use client";

import { useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DraftTask } from "@/lib/api/client";
import {
  COUNT_UNITS,
  SHIFT_TYPES,
  TASK_TYPE_SPECS,
  WEATHER,
  taskTypesFor,
  type Industry,
  type ShiftType,
  type TaskType,
  type Weather,
} from "@/lib/catalog";

function Pick<T extends string>({ id, value, onChange, options }: { id: string; value: T; onChange: (v: T) => void; options: readonly T[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * What the task is, how much of it, and the conditions — the inputs the
 * duration model actually reads. Every option comes from the model's own
 * catalog, so nothing here can be rejected by it.
 */
export function TaskInput({ industry, busy, onSubmit }: { industry: Industry; busy: boolean; onSubmit: (task: DraftTask) => void }) {
  const types = taskTypesFor(industry);
  const [type, setType] = useState<TaskType>(types[0]);
  const [quantity, setQuantity] = useState<number>(TASK_TYPE_SPECS[types[0]].typical);
  const [weather, setWeather] = useState<Weather>("Sunny");
  const [shift, setShift] = useState<ShiftType>("Day");

  // New site, new task types.
  const [lastIndustry, setLastIndustry] = useState(industry);
  if (lastIndustry !== industry) {
    setLastIndustry(industry);
    setType(types[0]);
    setQuantity(TASK_TYPE_SPECS[types[0]].typical);
  }

  const spec = TASK_TYPE_SPECS[type];
  const valid = Number.isFinite(quantity) && quantity > 0 && (!COUNT_UNITS.has(spec.unit) || Number.isInteger(quantity));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      task_id: `S-${Date.now().toString(36).toUpperCase()}`,
      task_type: type,
      industry,
      task_priority: 1,
      work_quantity: quantity,
      work_unit: spec.unit,
      weather,
      shift_type: shift,
      execution_mode: spec.executionMode,
      max_parallel: spec.maxParallel,
      required_machine_type: spec.machineType,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sim-type" className="text-small text-foreground-secondary">
          Task
        </Label>
        <Pick
          id="sim-type"
          value={type}
          onChange={(t) => {
            setType(t);
            setQuantity(TASK_TYPE_SPECS[t].typical);
          }}
          options={types}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sim-qty" className="text-small text-foreground-secondary">
          Quantity ({spec.unit})
        </Label>
        <Input
          id="sim-qty"
          type="number"
          min={0}
          step={COUNT_UNITS.has(spec.unit) ? 1 : "any"}
          value={Number.isFinite(quantity) ? quantity : ""}
          onChange={(e) => setQuantity(e.target.value === "" ? NaN : Number(e.target.value))}
          aria-invalid={!valid}
          className="tabular-nums"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-weather" className="text-small text-foreground-secondary">
            Weather
          </Label>
          <Pick id="sim-weather" value={weather} onChange={setWeather} options={WEATHER} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sim-shift" className="text-small text-foreground-secondary">
            Shift
          </Label>
          <Pick id="sim-shift" value={shift} onChange={setShift} options={SHIFT_TYPES} />
        </div>
      </div>
      <Button type="submit" disabled={!valid || busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        {busy ? "Assigning…" : "Add & assign"}
      </Button>
    </form>
  );
}
