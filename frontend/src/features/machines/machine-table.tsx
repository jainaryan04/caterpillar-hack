"use client";

import { useMemo, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/shared/data-table";
import { MachineChip } from "@/components/shared/entity-chip";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDuration, formatNumber } from "@/lib/format";
import { ENGINE_TEMP } from "@/lib/mock/machines";
import { engineTempTone, machineStatusMeta, toneClasses, toneIcon } from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Machine } from "@/lib/types";

interface MachineTableProps {
  machines: Machine[] | undefined;
  lookup: EntityLookup;
  selectedId: string | null;
  onSelect: (id: string) => void;
  toolbar?: ReactNode;
  filtersActive: boolean;
  onClearFilters: () => void;
}

/** Fleet table — spec §5.4 / §11. P1: machine, status; P2: temp, operator; P3 the rest. */
export function MachineTable({ machines, lookup, selectedId, onSelect, toolbar, filtersActive, onClearFilters }: MachineTableProps) {
  const columns = useMemo<ColumnDef<Machine>[]>(
    () => [
      {
        id: "machine",
        header: "Machine",
        accessorFn: (m) => m.id,
        cell: ({ row: { original: m } }) => <MachineChip machine={m} />,
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (m) => m.status,
        cell: ({ row: { original: m } }) => <StatusBadge meta={machineStatusMeta[m.status]} size="sm" />,
      },
      {
        id: "runtime",
        header: "Runtime",
        accessorFn: (m) => m.runtimeTodayMin,
        cell: ({ row: { original: m } }) => (
          <span className="flex flex-col items-end leading-tight">
            <span className="font-mono">{formatDuration(m.runtimeTodayMin)}</span>
            <span className="text-caption text-muted-foreground">{formatNumber(m.engineHours)} h total</span>
          </span>
        ),
        meta: { align: "right", className: "hidden xl:table-cell" },
      },
      {
        id: "velocity",
        header: "Velocity",
        accessorFn: (m) => m.velocityKph,
        cell: ({ row: { original: m } }) => (
          <span className={cn("font-mono", m.status === "offline" && "text-muted-foreground")}>
            {m.velocityKph.toFixed(1)} <span className="font-sans text-caption text-muted-foreground">km/h</span>
          </span>
        ),
        meta: { align: "right", className: "hidden lg:table-cell" },
      },
      {
        id: "temp",
        header: "Engine temp",
        accessorFn: (m) => m.engineTempC,
        cell: ({ row: { original: m } }) => {
          const tone = m.status === "offline" ? null : engineTempTone(m.engineTempC, ENGINE_TEMP);
          const Icon = tone ? toneIcon[tone] : null;
          return (
            <span
              className={cn(
                "inline-flex items-center justify-end gap-1 font-mono",
                tone ? toneClasses[tone].text : m.status === "offline" && "text-muted-foreground",
              )}
            >
              {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
              {m.engineTempC} <span className="font-sans text-caption text-muted-foreground">°C</span>
            </span>
          );
        },
        meta: { align: "right", className: "hidden sm:table-cell" },
      },
      {
        id: "operator",
        header: "Operator",
        accessorFn: (m) => lookup.operator(m.operatorId)?.name ?? "",
        cell: ({ getValue }) => getValue<string>() || <span className="text-muted-foreground">—</span>,
        meta: { className: "hidden md:table-cell" },
      },
      {
        id: "task",
        header: "Task",
        accessorFn: (m) => m.taskId ?? "",
        cell: ({ row: { original: m } }) => {
          const t = lookup.task(m.taskId);
          return t ? (
            <span className="flex max-w-56 flex-col leading-tight">
              <span className="truncate">{t.title}</span>
              <span className="font-mono text-caption text-muted-foreground">{t.id}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        meta: { className: "hidden 2xl:table-cell" },
      },
      {
        id: "lastSeen",
        header: "Last seen",
        accessorFn: (m) => m.lastSeen,
        cell: ({ row: { original: m } }) => (
          <RelativeTime iso={m.lastSeen} className={cn("text-caption", m.status === "offline" ? "text-warning" : "text-muted-foreground")} />
        ),
        meta: { className: "hidden xl:table-cell" },
      },
    ],
    [lookup],
  );

  return (
    <DataTable
      columns={columns}
      data={machines}
      isLoading={!machines}
      getRowId={(m) => m.id}
      searchText={(m) => `${m.id} ${m.model} ${lookup.operator(m.operatorId)?.name ?? ""}`}
      searchPlaceholder="Search ID, model, operator…"
      toolbar={toolbar}
      onRowClick={(m) => onSelect(m.id)}
      selectedId={selectedId}
      emptyTitle="No machines match these filters"
      filtersActive={filtersActive}
      onClearFilters={onClearFilters}
    />
  );
}
