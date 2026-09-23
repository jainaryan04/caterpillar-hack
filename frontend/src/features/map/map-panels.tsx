"use client";

import { useState } from "react";
import { Layers, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MachineChip, OperatorChip } from "@/components/shared/entity-chip";
import { SearchBar } from "@/components/shared/search-bar";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { StatusBadge } from "@/components/shared/status-badge";
import { RelativeTime } from "@/components/shared/relative-time";
import { availabilityMeta, machineStatusMeta } from "@/lib/status";
import type { Machine, Operator, SafetyAlert } from "@/lib/types";
import type { MapLayer, MapSelection } from "./site-map";

interface LayerPanelProps {
  layers: Record<MapLayer, boolean>;
  onToggle: (layer: MapLayer) => void;
  counts: Partial<Record<MapLayer, number>>;
}

const LAYER_LABELS: { key: MapLayer; label: string }[] = [
  { key: "machines", label: "Machines" },
  { key: "operators", label: "Operators on foot" },
  { key: "work", label: "Work sites" },
  { key: "restricted", label: "Restricted zones" },
  { key: "sos", label: "SOS" },
];

/** Layer toggles — SOS can't be hidden (spec §13). */
export function LayerPanel({ layers, onToggle, counts }: LayerPanelProps) {
  return (
    <section className="w-56 rounded-lg border bg-panel/95 p-3 shadow-lg backdrop-blur-none" aria-label="Map layers">
      <h2 className="eyebrow mb-2 flex items-center gap-1.5">
        <Layers className="size-3.5" /> Layers
      </h2>
      <ul className="flex flex-col gap-2">
        {LAYER_LABELS.map(({ key, label }) => {
          const locked = key === "sos";
          const control = (
            <li key={key} className="flex items-center gap-2">
              <Checkbox
                id={`layer-${key}`}
                checked={layers[key]}
                disabled={locked}
                onCheckedChange={() => onToggle(key)}
              />
              <Label htmlFor={`layer-${key}`} className={cn("flex-1 text-small", locked && "cursor-not-allowed")}>
                {label}
              </Label>
              {counts[key] !== undefined ? (
                <span className="font-mono text-caption text-muted-foreground tabular-nums">{counts[key]}</span>
              ) : null}
            </li>
          );
          return locked ? (
            <Tooltip key={key}>
              <TooltipTrigger asChild>{control}</TooltipTrigger>
              <TooltipContent side="left">SOS markers are always shown</TooltipContent>
            </Tooltip>
          ) : (
            control
          );
        })}
      </ul>
    </section>
  );
}

interface EntityListPanelProps {
  machines: Machine[];
  operators: Operator[];
  sos: SafetyAlert[];
  selection: MapSelection;
  onSelect: (s: MapSelection) => void;
  className?: string;
}

type Tab = "machines" | "operators" | "sos";

/** Left list synced with the map — click a row to focus its marker. */
export function EntityListPanel({ machines, operators, sos, selection, onSelect, className }: EntityListPanelProps) {
  const [tab, setTab] = useState<Tab>(sos.length ? "sos" : "machines");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const rowClass = (id: string) =>
    cn(
      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-raised",
      selection?.id === id && "bg-raised ring-1 ring-border-strong",
    );

  return (
    <section className={cn("flex w-72 flex-col overflow-hidden rounded-lg border bg-panel shadow-lg", className)} aria-label="Entities">
      <div className="flex flex-col gap-2 border-b p-3">
        <SegmentedControl
          ariaLabel="List"
          value={tab}
          onChange={setTab}
          className="w-full [&>*]:flex-1"
          options={[
            { value: "machines", label: `Machines` },
            { value: "operators", label: `People` },
            { value: "sos", label: `SOS ${sos.length || ""}`.trim() },
          ]}
        />
        {tab !== "sos" ? <SearchBar value={query} onChange={setQuery} placeholder="Filter…" /> : null}
      </div>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {tab === "machines"
          ? machines
              .filter((m) => !q || `${m.id} ${m.model}`.toLowerCase().includes(q))
              .map((m) => (
                <li key={m.id}>
                  <button type="button" className={rowClass(m.id)} onClick={() => onSelect({ kind: "machine", id: m.id })}>
                    <MachineChip machine={m} size="sm" />
                    <StatusBadge meta={machineStatusMeta[m.status]} size="sm" variant="plain" />
                  </button>
                </li>
              ))
          : null}
        {tab === "operators"
          ? operators
              .filter((o) => o.position)
              .filter((o) => !q || `${o.id} ${o.name}`.toLowerCase().includes(q))
              .map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={rowClass(o.id)}
                    onClick={() =>
                      onSelect(o.machineId ? { kind: "machine", id: o.machineId } : { kind: "operator", id: o.id })
                    }
                  >
                    <OperatorChip operator={o} size="sm" />
                    <span className="font-mono text-caption text-muted-foreground">
                      {o.machineId ?? availabilityMeta[o.availability].label}
                    </span>
                  </button>
                </li>
              ))
          : null}
        {tab === "sos" ? (
          sos.length ? (
            sos.map((a) => (
              <li key={a.id}>
                <button type="button" className={rowClass(a.id)} onClick={() => onSelect({ kind: "sos", id: a.id })}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Siren className="size-4 shrink-0 text-danger" aria-hidden />
                    <span className="truncate text-small">{a.title}</span>
                  </span>
                  <RelativeTime iso={a.raisedAt} mode="elapsed" className="font-mono text-caption text-danger" />
                </button>
              </li>
            ))
          ) : (
            <li className="p-4 text-center text-small text-muted-foreground">No active SOS</li>
          )
        ) : null}
      </ul>
    </section>
  );
}
