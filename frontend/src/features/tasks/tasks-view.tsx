"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, List, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ALL, FilterSelect } from "@/components/shared/filter-select";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useLookup, useMachines, useOperators, useTasks, useZones } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { formatTime } from "@/lib/format";
import { TASK_TYPES } from "@/lib/mock/tasks";
import { taskStatusMeta, taskTypeLabel } from "@/lib/status";
import type { Task, TaskStatus, TaskType } from "@/lib/types";
import { TaskDrawer } from "./task-drawer";
import { TaskFormDialog } from "./task-form-dialog";
import { TaskList } from "./task-list";
import { UnscheduledTray } from "./unscheduled-tray";

const TaskCalendar = dynamic(() => import("./task-calendar"), {
  ssr: false,
  loading: () => <ChartSkeleton className="m-3 h-[560px]" />,
});

type Mode = "calendar" | "list";

interface FormState {
  mode: "create" | "edit";
  initial?: Partial<Task>;
  key: number;
}

/**
 * Task scheduling — spec §5.2. Local edits (create, reschedule, complete) are
 * held in component state until the tasks API exists.
 */
export function TasksView() {
  const { data: serverTasks } = useTasks();
  const { data: machines } = useMachines();
  const { data: operators } = useOperators();
  const { data: zones } = useZones();
  const lookup = useLookup();

  const [selectedId, setSelectedId] = useQueryParam("task");
  const [statusParam, setStatusParam] = useQueryParam("status");
  const [mode, setMode] = useState<Mode>(statusParam ? "list" : "calendar");
  const [typeFilter, setTypeFilter] = useState<TaskType | typeof ALL>(ALL);
  const statusFilter = (statusParam as TaskStatus | null) ?? ALL;

  const [added, setAdded] = useState<Task[]>([]);
  const [patches, setPatches] = useState<Record<string, Partial<Task>>>({});
  const [form, setForm] = useState<FormState | null>(null);

  const tasks = useMemo(
    () =>
      serverTasks
        ? [...serverTasks, ...added].map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t))
        : undefined,
    [serverTasks, added, patches],
  );

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
  const nextId = `TSK-${2300 + added.length}`;

  const patch = (id: string, p: Partial<Task>) => setPatches((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  const clearFilters = () => {
    setTypeFilter(ALL);
    setStatusParam(null);
  };

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
            <Button onClick={() => setForm({ mode: "create", key: Date.now() })}>
              <Plus /> New task
            </Button>
          </>
        }
        toolbar={mode === "calendar" ? filters : undefined}
      />

      {mode === "calendar" ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1 lg:max-h-[calc(100dvh-15rem)]">
            <UnscheduledTray
              tasks={unscheduled}
              onOpen={setSelectedId}
              onSchedule={(t) => setForm({ mode: "edit", initial: t, key: Date.now() })}
            />
          </div>
          <div className="order-1 min-w-0 overflow-hidden rounded-lg border bg-panel lg:order-2 lg:h-[calc(100dvh-15rem)]">
            {filtered ? (
              <TaskCalendar
                tasks={filtered}
                lookup={lookup}
                onSelectTask={setSelectedId}
                onReschedule={(id, start, durationMin, revert) => {
                  const before = tasks?.find((t) => t.id === id);
                  patch(id, { start: start.toISOString(), durationMin });
                  toast.success(`${id} rescheduled to ${formatTime(start)}`, {
                    action: {
                      label: "Undo",
                      onClick: () => {
                        revert();
                        if (before) patch(id, { start: before.start, durationMin: before.durationMin });
                      },
                    },
                  });
                }}
                onCreateRange={(start, durationMin) =>
                  setForm({ mode: "create", initial: { start: start.toISOString(), durationMin }, key: Date.now() })
                }
              />
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
        onEdit={(t) => setForm({ mode: "edit", initial: t, key: Date.now() })}
        onComplete={(t) => {
          patch(t.id, { status: "completed" });
          toast.success(`${t.id} marked complete`);
        }}
      />

      {form && machines && operators && zones ? (
        <TaskFormDialog
          key={form.key}
          open
          onOpenChange={(o) => !o && setForm(null)}
          mode={form.mode}
          initial={form.initial}
          nextId={nextId}
          machines={machines}
          operators={operators}
          zones={zones}
          onSubmit={(t) => {
            if (form.mode === "create") {
              setAdded((a) => [...a, t]);
              toast.success(`${t.id} created`, { description: t.title });
            } else {
              patch(t.id, t);
              toast.success(`${t.id} updated`);
            }
            setForm(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}
