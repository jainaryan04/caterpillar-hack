"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ALL, FilterSelect } from "@/components/shared/filter-select";
import { CardGridSkeleton } from "@/components/shared/loading-skeleton";
import { MetaDot, PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SearchBar } from "@/components/shared/search-bar";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { SummaryStrip } from "@/components/shared/summary-strip";
import { useAlerts, useLookup, useMachines, useSite, useZones } from "@/hooks/use-fleet-data";
import { machineTypesFor } from "@/lib/catalog";
import { useQueryParam } from "@/hooks/use-query-param";
import { machineStatusMeta } from "@/lib/status";
import type { MachineStatus, MachineType } from "@/lib/types";
import { MachineCard } from "./machine-card";
import { MachineDrawer } from "./machine-drawer";
import { MachineTable } from "./machine-table";

const STATUSES: MachineStatus[] = ["operating", "idle", "fault", "maintenance", "offline"];

/** Machines — spec §5.4: live condition of every machine; find the ones that need attention. */
export function MachinesView() {
  const { data: machines } = useMachines();
  const { data: alerts } = useAlerts();
  const { data: zones } = useZones();
  const lookup = useLookup();
  const site = useSite();
  const [selectedId, setSelectedId] = useQueryParam("machine");
  const [status, setStatus] = useQueryParam("status");
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [type, setType] = useState<MachineType | typeof ALL>(ALL);
  const [gridQuery, setGridQuery] = useState("");

  const filtered = useMemo(
    () => machines?.filter((m) => (!status || m.status === status) && (type === ALL || m.type === type)),
    [machines, status, type],
  );
  const gridRows = useMemo(() => {
    const q = gridQuery.trim().toLowerCase();
    return q ? filtered?.filter((m) => `${m.id} ${m.model}`.toLowerCase().includes(q)) : filtered;
  }, [filtered, gridQuery]);

  const filtersActive = Boolean(status) || type !== ALL;
  const clear = () => {
    setStatus(null);
    setType(ALL);
    setGridQuery("");
  };

  const filters = (
    <>
      <FilterSelect
        label="Type"
        value={type}
        onChange={setType}
        options={[...machineTypesFor(site)].sort().map((t) => ({ value: t, label: t }))}
      />
      {filtersActive ? (
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear filters
        </Button>
      ) : null}
    </>
  );

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Machines"
        className="pb-1"
        description={
          machines ? (
            <>
              <span>{machines.length} machines</span>
              <MetaDot />
              <span>{site}</span>
            </>
          ) : undefined
        }
        actions={
          <SegmentedControl
            ariaLabel="Layout"
            value={layout}
            onChange={setLayout}
            iconOnlyOnMobile
            options={[
              { value: "table", label: "Table", icon: Rows3 },
              { value: "grid", label: "Grid", icon: LayoutGrid },
            ]}
          />
        }
      />

      <SummaryStrip
        active={status}
        onSelect={setStatus}
        items={STATUSES.map((s) => ({
          key: s,
          label: machineStatusMeta[s].label,
          value: machines?.filter((m) => m.status === s).length ?? 0,
          icon: machineStatusMeta[s].icon,
          tone: machineStatusMeta[s].tone,
        }))}
      />

      {layout === "table" ? (
        <MachineTable
          machines={filtered}
          lookup={lookup}
          selectedId={selectedId}
          onSelect={setSelectedId}
          toolbar={filters}
          filtersActive={filtersActive}
          onClearFilters={clear}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar value={gridQuery} onChange={setGridQuery} placeholder="Search ID or model…" className="w-full sm:w-64" />
            {filters}
          </div>
          {!gridRows ? (
            <CardGridSkeleton />
          ) : gridRows.length === 0 ? (
            <div className="rounded-lg border bg-panel">
              <EmptyState
                variant="filtered"
                title="No machines match these filters"
                action={
                  <Button variant="secondary" size="sm" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {gridRows.map((m) => (
                <MachineCard
                  key={m.id}
                  machine={m}
                  operator={lookup.operator(m.operatorId)}
                  task={lookup.task(m.taskId)}
                  selected={m.id === selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <MachineDrawer
        machine={machines?.find((m) => m.id === selectedId)}
        alerts={alerts ?? []}
        zones={zones ?? []}
        lookup={lookup}
        onClose={() => setSelectedId(null)}
      />
    </PageContainer>
  );
}
