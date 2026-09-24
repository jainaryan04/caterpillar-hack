"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { OperatorChip } from "@/components/shared/entity-chip";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { ShiftProgress } from "@/components/shared/shift-progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { availabilityMeta } from "@/lib/status";
import type { Operator, Task } from "@/lib/types";

interface OperatorTableProps {
  operators: Operator[] | undefined;
  tasks: Task[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar?: ReactNode;
  filtersActive: boolean;
  onClearFilters: () => void;
}

/** Roster table — spec §5.3 columns. P1: operator, availability; P2: fatigue, shift. */
export function OperatorTable({
  operators,
  tasks,
  selectedId,
  onSelect,
  toolbar,
  filtersActive,
  onClearFilters,
}: OperatorTableProps) {
  const openTasks = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks ?? []) {
      if (!t.operatorId || t.status === "completed" || t.status === "cancelled") continue;
      map.set(t.operatorId, (map.get(t.operatorId) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const columns = useMemo<ColumnDef<Operator>[]>(
    () => [
      {
        id: "operator",
        header: "Operator",
        accessorFn: (o) => o.id,
        cell: ({ row: { original: o } }) => <OperatorChip operator={o} />,
      },
      {
        id: "shift",
        header: "Current shift",
        accessorFn: (o) => o.hoursWorked / (o.plannedHours || 1),
        cell: ({ row: { original: o } }) => (
          <ShiftProgress shift={o.shift} hoursWorked={o.hoursWorked} plannedHours={o.plannedHours} compact />
        ),
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "hours",
        header: "Hours",
        accessorFn: (o) => o.hoursWorked,
        cell: ({ row: { original: o } }) => (
          <span className="flex flex-col items-end leading-tight">
            <span className="font-mono">{o.hoursWorked.toFixed(1)} h</span>
            <span className="text-caption text-muted-foreground">in this plan</span>
          </span>
        ),
        meta: { align: "right", className: "hidden xl:table-cell" },
      },
      {
        id: "fatigue",
        header: "Fatigue",
        accessorFn: (o) => o.fatigue,
        cell: ({ row: { original: o } }) => <FatigueIndicator score={o.fatigue} />,
        meta: { className: "hidden sm:table-cell" },
      },
      {
        id: "tasks",
        header: "Tasks",
        accessorFn: (o) => openTasks.get(o.id) ?? 0,
        cell: ({ getValue }) => <span className="font-mono">{getValue<number>()}</span>,
        meta: { align: "right", className: "hidden lg:table-cell" },
      },
      {
        id: "availability",
        header: "Availability",
        accessorFn: (o) => o.availability,
        cell: ({ row: { original: o } }) => <StatusBadge meta={availabilityMeta[o.availability]} size="sm" />,
      },
      {
        id: "machine",
        header: "Machine",
        accessorFn: (o) => o.machineId ?? "",
        cell: ({ row: { original: o } }) =>
          o.machineId ? <span className="font-mono">{o.machineId}</span> : <span className="text-muted-foreground">—</span>,
        meta: { className: "hidden lg:table-cell" },
      },
    ],
    [openTasks],
  );

  return (
    <DataTable
      columns={columns}
      data={operators}
      isLoading={!operators}
      getRowId={(o) => o.id}
      searchText={(o) => `${o.id} ${o.skills.join(" ")} ${o.machineId ?? ""}`}
      searchPlaceholder="Search operators…"
      toolbar={toolbar}
      onRowClick={(o) => onSelect(o.id)}
      selectedId={selectedId}
      emptyTitle="No operators match these filters"
      filtersActive={filtersActive}
      onClearFilters={onClearFilters}
    />
  );
}
