"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, CalendarRange, List } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ALL, FilterSelect } from "@/components/shared/filter-select";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useCompleteTask, useLookup, useSite, useTasks } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { taskTypesFor } from "@/lib/catalog";
import { taskStatusMeta } from "@/lib/status";
import type { TaskStatus, TaskType } from "@/lib/types";
import { TaskDrawer } from "./task-drawer";
import { TaskList } from "./task-list";
import { UnscheduledTray } from "./unscheduled-tray";

const TaskCalendar = dynamic(() => import("./task-calendar"), {
  ssr: false,
  loading: () => <ChartSkeleton className="m-3 h-[560px]" />,
});

type Mode = "calendar" | "list";

/**
 * The published plan for this site — read-only apart from "Mark complete"
 * (PATCH /v1/assignments/{id}). Trying out new tasks happens in the
 * /simulation scheduler; nothing on this page publishes. There is no drag-to-reschedule either: the
 * solver owns timing and assignment, not a calendar drag.
 */
export function TasksView() {
  const router = useRouter();
  const site = useSite();
  const { data: tasks } = useTasks();
  const lookup = useLookup();
  const completeTask = useCompleteTask();

  const [selectedId, setSelectedId] = useQueryParam("task");
  const [statusParam, setStatusParam] = useQueryParam("status");
  const [mode, setMode] = useState<Mode>(statusParam ? "list" : "calendar");
  const [typeFilter, setTypeFilter] = useState<TaskType | typeof ALL>(ALL);
  const statusFilter = (statusParam as TaskStatus | null) ?? ALL;

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

  const toSimulate = () => router.push("/simulation");

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
        options={taskTypesFor(site).map((t) => ({ value: t, label: t }))}
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
            <Button asChild>
              <Link href="/simulation">
                <CalendarRange /> Schedule tasks
              </Link>
            </Button>
          </>
        }
        toolbar={mode === "calendar" ? filters : undefined}
      />

      {mode === "calendar" ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)]">
          <div className="order-2 lg:order-1 lg:max-h-[calc(100dvh-15rem)]">
            <UnscheduledTray tasks={unscheduled} onOpen={setSelectedId} onSchedule={toSimulate} />
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
    </PageContainer>
  );
}
