"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { ComplexityPips } from "@/components/shared/complexity-pips";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { complexityLevel, taskStatusMeta, taskTypeIcon } from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Task } from "@/lib/types";

interface TaskListProps {
  tasks: Task[] | undefined;
  lookup: EntityLookup;
  onSelect: (id: string) => void;
  selectedId: string | null;
  toolbar?: React.ReactNode;
  filtersActive: boolean;
  onClearFilters: () => void;
}

export function TaskList({ tasks, lookup, onSelect, selectedId, toolbar, filtersActive, onClearFilters }: TaskListProps) {
  const columns = useMemo<ColumnDef<Task>[]>(
    () => [
      {
        id: "task",
        header: "Task",
        accessorFn: (t) => t.id,
        cell: ({ row: { original: t } }) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{t.title}</span>
            <span className="font-mono text-caption text-muted-foreground">{t.id}</span>
          </span>
        ),
      },
      {
        id: "type",
        header: "Type",
        accessorFn: (t) => t.type,
        cell: ({ row: { original: t } }) => {
          const Icon = taskTypeIcon(t.type);
          return (
            <span className="flex items-center gap-1.5 text-foreground-secondary">
              <Icon className="size-4" aria-hidden /> {t.type}
            </span>
          );
        },
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "complexity",
        header: "Cplx",
        accessorFn: (t) => complexityLevel[t.complexity],
        cell: ({ row: { original: t } }) => <ComplexityPips complexity={t.complexity} />,
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "machine",
        header: "Machine",
        accessorFn: (t) => t.machineId ?? "",
        cell: ({ row: { original: t } }) =>
          t.machineId ? <span className="font-mono">{t.machineId}</span> : <span className="text-muted-foreground">—</span>,
        meta: { className: "hidden lg:table-cell" },
      },
      {
        id: "operator",
        header: "Operator",
        accessorFn: (t) => lookup.operator(t.operatorId)?.id ?? "",
        cell: ({ getValue }) => (getValue<string>() || <span className="text-muted-foreground">Unassigned</span>),
        meta: { className: "hidden lg:table-cell" },
      },
      {
        id: "start",
        header: "Scheduled",
        accessorFn: (t) => t.start ?? "9999",
        cell: ({ row: { original: t } }) =>
          t.start ? (
            <span className="flex flex-col leading-tight">
              <span className="tabular-nums">{formatTime(t.start)}</span>
              <span className="text-caption text-muted-foreground">{formatDate(t.start)}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Unscheduled</span>
          ),
      },
      {
        id: "duration",
        header: "Duration",
        accessorFn: (t) => t.durationMin,
        cell: ({ getValue }) => formatDuration(getValue<number>()),
        meta: { align: "right", className: "hidden sm:table-cell" },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (t) => t.status,
        cell: ({ row: { original: t } }) => <StatusBadge meta={taskStatusMeta[t.status]} size="sm" />,
      },
    ],
    [lookup],
  );

  return (
    <DataTable
      columns={columns}
      data={tasks}
      isLoading={!tasks}
      getRowId={(t) => t.id}
      searchText={(t) => `${t.id} ${t.title} ${t.machineId ?? ""} ${lookup.operator(t.operatorId)?.id ?? ""}`}
      searchPlaceholder="Search tasks, machines, operators…"
      toolbar={toolbar}
      onRowClick={(t) => onSelect(t.id)}
      selectedId={selectedId}
      emptyTitle="No tasks match these filters"
      filtersActive={filtersActive}
      onClearFilters={onClearFilters}
    />
  );
}
