"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SectionCard } from "@/components/shared/section-card";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useRoster, useSite } from "@/hooks/use-fleet-data";
import { api, type DraftTask } from "@/lib/api/client";
import type { ShiftType } from "@/lib/catalog";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { taskTypeIcon } from "@/lib/status";
import { blank, useSimStore, type SimDay } from "@/stores/sim-store";
import { assign } from "./assign";
import { SHIFT_MIN, dateKey, shiftTime, tomorrow } from "./day";
import { ScheduleGantt } from "./schedule-gantt";
import { TaskInput } from "./task-input";

const SHIFTS: { value: ShiftType; label: string }[] = [
  { value: "Day", label: "Day 06–18" },
  { value: "Night", label: "Night 18–06" },
];

const dayLabel = (date: string) => formatDate(`${date}T12:00:00`);

/**
 * Schedule — pick a day, add tasks, see who does each one and when.
 *
 * Each task is assigned the moment it's added: the duration model
 * (POST /v1/predict, ~2 s) prices every legal worker + machine pairing, and
 * the one that would finish earliest — given what's already queued on each
 * worker and machine that day — gets it, starting from the shift start.
 *
 * Days live in this browser; nothing is written to the database.
 */
export function SimulationView() {
  const site = useSite();
  const { data: roster } = useRoster();
  const { activeDate, days, open, setShift, add, remove, clear } = useSimStore();

  // Read-only default until the user picks a date, so nothing is written
  // before the saved days have loaded.
  const [fallback] = useState(tomorrow);
  const date = activeDate ?? fallback;
  const day: SimDay = days[date] ?? blank(date);

  const place = useMutation({
    mutationFn: async (task: DraftTask) => {
      if (!roster) throw new Error("Roster not loaded yet.");
      const result = await api.predict(task, 100);
      return assign(task, result, roster, day.tasks, date === dateKey(new Date()));
    },
    onSuccess: (s) => {
      add(date, s);
      toast.success(`${s.task.task_type} → ${s.worker_id} on ${s.machine_id}`, {
        description: `${at(s.start_min)} – ${at(s.end_min)}`,
      });
    },
    onError: (e) => toast.error("Couldn't schedule that task", { description: String(e) }),
  });

  const at = (min: number) => formatTime(shiftTime(date, day.shift, min));
  const end = Math.max(0, ...day.tasks.map((s) => s.end_min));
  const rows = [...day.tasks].sort((a, b) => a.start_min - b.start_min || a.worker_id.localeCompare(b.worker_id));
  const history = Object.values(days)
    .filter((d) => d.tasks.length)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Schedule"
        description={
          <>
            <span>{site}</span>
            <MetaDot />
            <span>{dayLabel(date)}</span>
            <MetaDot />
            <span>{day.shift} shift</span>
          </>
        }
        actions={
          <>
            <Input
              type="date"
              aria-label="Day to schedule"
              value={date}
              onChange={(e) => e.target.value && open(e.target.value)}
              className="h-9 w-40 tabular-nums"
            />
            <SegmentedControl ariaLabel="Shift" value={day.shift} onChange={(s) => setShift(date, s)} options={SHIFTS} />
            <Button variant="secondary" onClick={clear} disabled={!history.length}>
              <Trash2 /> Clear all
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <SectionCard title="Inputs" subtitle={`${dayLabel(date)} · ${day.shift} shift from ${at(0)}`}>
            <TaskInput
              industry={site}
              shift={day.shift}
              busy={place.isPending || !roster}
              onSubmit={(task) => place.mutate(task)}
            />
          </SectionCard>

          {history.length > 0 && (
            <SectionCard title="Days" bodyClassName="p-0">
              <ul className="divide-y">
                {history.map((d) => (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => open(d.date)}
                      aria-current={d.date === date ? "true" : undefined}
                      className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-small hover:bg-raised aria-[current=true]:bg-raised"
                    >
                      <span className="font-medium">
                        {dayLabel(d.date)} <span className="text-foreground-secondary">· {d.shift}</span>
                      </span>
                      <span className="text-caption text-foreground-secondary">
                        {d.tasks.length} task{d.tasks.length === 1 ? "" : "s"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <SectionCard
            title="Schedule"
            subtitle={
              day.tasks.length
                ? `${day.tasks.length} task${day.tasks.length === 1 ? "" : "s"} · ${at(0)} → ${at(end)}`
                : undefined
            }
            bodyClassName="p-0"
            footer={
              end > SHIFT_MIN ? (
                <p className="text-caption text-warning">
                  Work runs {formatDuration(end - SHIFT_MIN)} past the end of the 12h shift (dashed line).
                </p>
              ) : undefined
            }
          >
            {day.tasks.length ? (
              <ScheduleGantt day={day} />
            ) : (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled for this day"
                description="Add a task — it's assigned to a worker and machine with a start and finish time."
              />
            )}
          </SectionCard>

          {rows.length > 0 && (
            <SectionCard title="Assignments" bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead className="border-b text-left">
                    <tr>
                      <th className="eyebrow px-4 py-2">Task</th>
                      <th className="eyebrow px-4 py-2">Assigned to</th>
                      <th className="eyebrow px-4 py-2">Machine</th>
                      <th className="eyebrow px-4 py-2">Start</th>
                      <th className="eyebrow px-4 py-2">Finish</th>
                      <th className="eyebrow px-4 py-2 text-right">Duration</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((s) => {
                      const Icon = taskTypeIcon(s.task.task_type);
                      return (
                        <tr key={s.id}>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-2 font-medium whitespace-nowrap">
                              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                              {s.task.task_type}
                            </span>
                            <span className="text-caption text-foreground-secondary">
                              {s.task.work_quantity} {s.task.work_unit} · {s.task.weather}
                            </span>
                          </td>
                          <td className="px-4 py-2 font-mono">{s.worker_id}</td>
                          <td className="px-4 py-2 whitespace-nowrap">
                            <span className="font-mono">{s.machine_id}</span>{" "}
                            <span className="text-foreground-secondary">· {s.machine_type}</span>
                          </td>
                          <td className="px-4 py-2 font-mono tabular-nums">{at(s.start_min)}</td>
                          <td className="px-4 py-2 font-mono tabular-nums">{at(s.end_min)}</td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {formatDuration(s.predicted_min)}
                          </td>
                          <td className="px-2 py-2">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              aria-label={`Remove ${s.task.task_type}`}
                              onClick={() => remove(date, s.id)}
                            >
                              <X />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
