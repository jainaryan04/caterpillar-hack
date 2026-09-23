"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatTime } from "@/lib/format";
import { alertCategoryLabel, alertStatusMeta, severityMeta } from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { SafetyAlert, Severity } from "@/lib/types";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Incident log — spec §5.7: every event, including resolved, for the safety record. */
export function IncidentTable({
  alerts,
  lookup,
  onSelect,
  selectedId,
}: {
  alerts: SafetyAlert[] | undefined;
  lookup: EntityLookup;
  onSelect: (id: string) => void;
  selectedId: string | null;
}) {
  const columns = useMemo<ColumnDef<SafetyAlert>[]>(
    () => [
      {
        id: "raised",
        header: "Raised",
        accessorFn: (a) => a.raisedAt,
        cell: ({ row: { original: a } }) => (
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums">{formatTime(a.raisedAt)}</span>
            <span className="text-caption text-muted-foreground">{formatDate(a.raisedAt)}</span>
          </span>
        ),
      },
      {
        id: "event",
        header: "Event",
        accessorFn: (a) => a.title,
        cell: ({ row: { original: a } }) => (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{a.title}</span>
            <span className="font-mono text-caption text-muted-foreground">
              {a.id} · {alertCategoryLabel[a.category]}
            </span>
          </span>
        ),
      },
      {
        id: "severity",
        header: "Severity",
        accessorFn: (a) => SEVERITY_RANK[a.severity],
        cell: ({ row: { original: a } }) => <StatusBadge meta={severityMeta[a.severity]} size="sm" variant="plain" />,
        meta: { className: "hidden sm:table-cell" },
      },
      {
        id: "zone",
        header: "Location",
        accessorFn: (a) => lookup.zone(a.zoneId)?.name ?? "",
        meta: { className: "hidden lg:table-cell" },
      },
      {
        id: "assignee",
        header: "Owner",
        accessorFn: (a) => a.assignee ?? "",
        cell: ({ getValue }) => getValue<string>() || <span className="text-muted-foreground">—</span>,
        meta: { className: "hidden xl:table-cell" },
      },
      {
        id: "status",
        header: "Status",
        accessorFn: (a) => a.status,
        cell: ({ row: { original: a } }) => <StatusBadge meta={alertStatusMeta[a.status]} size="sm" />,
      },
    ],
    [lookup],
  );

  return (
    <DataTable
      columns={columns}
      data={alerts ? [...alerts].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt)) : undefined}
      isLoading={!alerts}
      getRowId={(a) => a.id}
      searchText={(a) => `${a.id} ${a.title} ${a.assignee ?? ""} ${lookup.zone(a.zoneId)?.name ?? ""}`}
      searchPlaceholder="Search events…"
      onRowClick={(a) => onSelect(a.id)}
      selectedId={selectedId}
      emptyTitle="No events recorded"
    />
  );
}
