"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, List, Loader2, Plus, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ALL, FilterSelect } from "@/components/shared/filter-select";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SegmentedControl } from "@/components/shared/segmented-control";
import {
  useCompleteTask,
  useCreateTask,
  useLookup,
  useReplan,
  useTasks,
} from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { TASK_TYPES } from "@/lib/mock/tasks";
import { taskStatusMeta, taskTypeLabel } from "@/lib/status";
import type { TaskStatus, TaskType } from "@/lib/types";
import type { CreateTaskInput } from "@/lib/api/client";
import { TaskDrawer } from "./task-drawer";
import { TaskFormDialog } from "./task-form-dialog";
import { TaskList } from "./task-list";
import { UnscheduledTray } from "./unscheduled-tray";

const TaskCalendar = dynamic(() => import("./task-calendar"), {
  ssr: false,
  loading: () => <ChartSkeleton className="m-3 h-[560px]" />,
});

type Mode = "calendar" | "list";

/**
 * Task scheduling — real data end to end. "New task" adds a task and
 * re-runs the plan (POST /v1/plan); "Mark complete" marks its assignment
 * done (PATCH /v1/assignments/{id}); "Replan" re-runs the plan as-is. There
 * is no drag-to-reschedule or manual field edit: neither is a real backend
 * capability (the solver owns timing/assignment, not a calendar drag).
 */
export function TasksView() {
  const { data: tasks } = useTasks();
  const lookup = useLookup();
  const createTask = useCreateTask();
  const completeTask = useCompleteTask();
  const replan = useReplan();

  const [selectedId, setSelectedId] = useQueryParam("task");
  const [statusParam, setStatusParam] = useQueryParam("status");
  const [mode, setMode] = useState<Mode>(statusParam ? "list" : "calendar");
  const [typeFilter, setTypeFilter] = useState<TaskType | typeof ALL>(ALL);
  const statusFilter = (statusParam as TaskStatus | null) ?? ALL;
  const [formOpen, setFormOpen] = useState(false);

  const filtered = useMemo(
    () =>
      tasks?.filter(
        (t) => (statusFilter === ALL || t.status === statusFilter) && (typeFilter === ALL || t.type === typeFilter),
      ),
    [tasks, statusFilter, typeFilter],
  );

  const selected = tasks?.find((t) => t.id === selectedId);
  const unscheduled = (filtered ?? []).filter((t) => !t.start);
  const delayedCount = tasks?.filter((t) => t.status === "delayed").length ?? 0;
  const filtersActive = statusFilter !== ALL || typeFilter !== ALL;

  const clearFilters = () => {
    setTypeFilter(ALL);
    setStatusParam(null);
  };

  const submitCreate = (input: CreateTaskInput) => {
    createTask.mutate(input, {
      onSuccess: () => {
        toast.success("Task created and scheduled", {
          description: `${input.priority ? `Priority ${input.priority} · ` : ""}${input.quantity} ${taskTypeLabel[input.type]}`,
        });
        setFormOpen(false);
      },
      onError: (e) => toast.error("Couldn't schedule the new task", { description: String(e) }),
    });
  };

  const runReplan = () =>
    replan.mutate(undefined, {
      onSuccess: () => toast.success("Plan re-run"),
      onError: (e) => toast.error("Replan failed", { description: String(e) }),
    });

  const markComplete = (id: string) =>
    completeTask.mutate(id, {
      onSuccess: () => toast.success(`${id} marked complete`),
      onError: (e) => toast.error(`Couldn't complete ${id}`, { description: String(e) }),
    });

  const filters = (
    <>
      <FilterSelect
        label="Status"
        value={statusFilter}
        onChange={(v) => setStatusParam(v === ALL ? null : v)}
        options={(Object.keys(taskStatusMeta) as TaskStatus[]).map((s) => ({ value: s, label: taskStatusMeta[s].label }))}
      />
      <FilterSelect
        label="Type"
        value={typeFilter}
        onChange={setTypeFilter}
        options={TASK_TYPES.map((t) => ({ value: t, label: taskTypeLabel[t] }))}
      />
      {filtersActive ? (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      ) : null}
    </>
  );

  return (
    <PageContainer className="flex min-h-full flex-col">
      <PageHeader
        title="Tasks"
        description={
          tasks ? (
            <>
              <span>{tasks.filter((t) => t.start).length} scheduled</span>
              <MetaDot />
              <span className={delayedCount ? "text-warning" : undefined}>{delayedCount} delayed</span>
              <MetaDot />
              <span>{tasks.filter((t) => !t.start).length} unscheduled</span>
            </>
          ) : undefined
        }
        actions={
          <>
            <SegmentedControl
              ariaLabel="Layout"
              value={mode}
              onChange={setMode}
              iconOnlyOnMobile
              options={[
                { value: "calendar", label: "Calendar", icon: CalendarDays },
                { value: "list", label: "List", icon: List },
              ]}
            />
            <Button variant="secondary" onClick={runReplan} disabled={replan.isPending}>
              {replan.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />} Replan
            </Button>
            <Button onClick={() => setFormOpen(true)}>
              <Plus /> New task
            </Button>
          </>
        }
        toolbar={mode === "calendar" ? filters : undefined}
      />

      {mode === "calendar" ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1 lg:max-h-[calc(100dvh-15rem)]">
            <UnscheduledTray tasks={unscheduled} onOpen={setSelectedId} onSchedule={runReplan} />
          </div>
          <div className="order-1 min-w-0 overflow-hidden rounded-lg border bg-panel lg:order-2 lg:h-[calc(100dvh-15rem)]">
            {filtered ? (
              <TaskCalendar tasks={filtered} lookup={lookup} onSelectTask={setSelectedId} />
            ) : (
              <ChartSkeleton className="m-3 h-[560px]" />
            )}
          </div>
        </div>
      ) : (
        <TaskList
          tasks={filtered}
          lookup={lookup}
          onSelect={setSelectedId}
          selectedId={selectedId}
          toolbar={filters}
          filtersActive={filtersActive}
          onClearFilters={clearFilters}
        />
      )}

      <TaskDrawer
        task={selected}
        lookup={lookup}
        onClose={() => setSelectedId(null)}
        onComplete={(t) => markComplete(t.id)}
        completing={completeTask.isPending}
      />

      <TaskFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={submitCreate}
        submitting={createTask.isPending}
      />
    </PageContainer>
  );
}
