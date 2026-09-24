"use client";

import { useEffect, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { ClipboardList, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SectionCard } from "@/components/shared/section-card";
import { useLiveMachinesSnapshot, useRoster, useSite, useZoneAssignments, useZones } from "@/hooks/use-fleet-data";
import { useReplayClock } from "@/hooks/use-replay-clock";
import { api, type DraftTask } from "@/lib/api/client";
import { formatDateTime, formatDuration } from "@/lib/format";
import { taskTypeIcon } from "@/lib/status";
import { useSimStore } from "@/stores/sim-store";
import { assign } from "./assign";
import { buildLanes, type Bar } from "./replay";
import { ReplayMap } from "./replay-map";
import { ResourceLanes } from "./resource-lanes";
import { TaskInput } from "./task-input";

/** However long the simulated work takes, it plays back in this long. */
const PLAYBACK_MS = 5000;

/**
 * Simulate — add a task, it is assigned at once to a worker and machine, and
 * plays out on the site map in a few seconds.
 *
 * Assignment uses the duration model only (POST /v1/predict, ~2 s) — no
 * scheduler run. It is a sandbox: tasks live in this browser, nothing is
 * written to the database, and "Clear all" removes them.
 */
export function SimulationView() {
  const site = useSite();
  const { data: roster } = useRoster();
  const { data: zones } = useZones();
  const { data: zoneAssignments } = useZoneAssignments();
  const { data: live } = useLiveMachinesSnapshot();
  const { tasks, startedAt, add, clear } = useSimStore();

  const bars: Bar[] = useMemo(
    () =>
      tasks.map((s) => ({
        id: s.id,
        task_id: s.id,
        task_type: s.task.task_type,
        worker_id: s.worker_id,
        machine_id: s.machine_id,
        machine_type: s.machine_type,
        start_min: s.start_min,
        end_min: s.end_min,
      })),
    [tasks],
  );
  const total = bars.reduce((m, b) => Math.max(m, b.end_min), 0);
  const lanes = useMemo(() => buildLanes(bars), [bars]);
  const clock = useReplayClock(total, PLAYBACK_MS);

  const place = useMutation({
    mutationFn: async (task: DraftTask) => {
      if (!roster) throw new Error("Roster not loaded yet.");
      const result = await api.predict(task, 100);
      return assign(task, result, roster, useSimStore.getState().tasks);
    },
    onSuccess: (s) => {
      add(s);
      toast.success(`${s.task.task_type} → ${s.worker_id} on ${s.machine_id}`, {
        description: `Predicted ${formatDuration(s.predicted_min)}`,
      });
    },
    onError: (e) => toast.error("Couldn't assign that task", { description: String(e) }),
  });

  // Every new task replays the whole simulation from the start.
  const { restart, play } = clock;
  useEffect(() => {
    if (!tasks.length) return;
    restart();
    play();
  }, [tasks.length, restart, play]);

  const at = (min: number) =>
    startedAt ? formatDateTime(new Date(new Date(startedAt).getTime() + min * 60_000).toISOString()) : "";
  const workers = new Set(tasks.map((t) => t.worker_id)).size;
  const machines = new Set(tasks.map((t) => t.machine_id)).size;

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Simulate"
        description={
          <>
            <span>{site}</span>
            <MetaDot />
            <span>Sandbox — nothing is saved</span>
          </>
        }
        actions={
          <Button variant="secondary" onClick={clear} disabled={!tasks.length}>
            <Trash2 /> Clear all
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <SectionCard title="New task">
            <TaskInput industry={site} busy={place.isPending || !roster} onSubmit={(t) => place.mutate(t)} />
          </SectionCard>

          <SectionCard
            title="Tasks"
            subtitle={tasks.length ? `${tasks.length} · all done in ${formatDuration(total)}` : undefined}
            bodyClassName="p-0"
          >
            {tasks.length ? (
              <ul className="divide-y">
                {tasks.map((s) => {
                  const Icon = taskTypeIcon(s.task.task_type);
                  return (
                    <li key={s.id} className="flex flex-col gap-1.5 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-small font-medium">
                          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{s.task.task_type}</span>
                        </span>
                        <span className="font-mono text-small tabular-nums">{formatDuration(s.predicted_min)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-foreground-secondary">
                        <span>
                          <span className="font-mono text-foreground">{s.worker_id}</span> · skill {s.worker_skill}
                        </span>
                        <FatigueIndicator score={Math.round(s.worker_fatigue)} />
                        <span>
                          <span className="font-mono text-foreground">{s.machine_id}</span> · {s.machine_type}
                        </span>
                      </div>
                      <p className="text-caption text-muted-foreground">
                        {s.task.work_quantity} {s.task.work_unit} · {at(s.start_min)} → {at(s.end_min)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState
                icon={ClipboardList}
                title="No tasks yet"
                description="Add a task — it's assigned to an available worker and machine straight away."
              />
            )}
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <SectionCard
            title="Site"
            subtitle={
              tasks.length
                ? `${workers} worker${workers === 1 ? "" : "s"} · ${machines} machine${machines === 1 ? "" : "s"}`
                : undefined
            }
            bodyClassName="p-0"
            footer={
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={clock.toggle}
                  disabled={!tasks.length}
                  aria-label={clock.playing ? "Pause" : "Play"}
                >
                  {clock.playing ? <Pause /> : <Play />}
                </Button>
                <Button size="sm" variant="ghost" onClick={clock.restart} disabled={!tasks.length} aria-label="Restart">
                  <RotateCcw />
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, total)}
                  step={1}
                  value={Math.round(clock.t)}
                  onChange={(e) => clock.seek(Number(e.target.value))}
                  disabled={!tasks.length}
                  aria-label="Simulation time"
                  className="min-w-0 flex-1 accent-foreground"
                />
                <span className="w-32 shrink-0 text-right font-mono text-caption text-foreground-secondary tabular-nums">
                  +{formatDuration(clock.t)} / {formatDuration(total)}
                </span>
              </div>
            }
          >
            <div className="aspect-[25/16]">
              <ReplayMap
                portions={bars}
                t={clock.t}
                zones={zones ?? []}
                zoneAssignments={zoneAssignments ?? []}
                live={live ?? []}
              />
            </div>
          </SectionCard>

          {lanes.length ? (
            <SectionCard title="Timeline" subtitle="Click a bar to jump to it" bodyClassName="p-0">
              <ResourceLanes lanes={lanes} makespan={total} t={clock.t} onSeek={clock.seek} />
            </SectionCard>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}
