"use client";

import { useState } from "react";
import { Info, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAlerts, useLookup, useMachines, useOperators, useZones } from "@/hooks/use-fleet-data";
import { useQueryParam } from "@/hooks/use-query-param";
import { ConnectionStatus } from "@/components/shell/connection-status";
import { MapEntityDrawer } from "./map-entity-drawer";
import { MapLegend } from "./map-legend";
import { EntityListPanel, LayerPanel } from "./map-panels";
import { SiteMap, type MapLayer, type MapSelection } from "./site-map";

function selectionFromFocus(focus: string | null): MapSelection {
  if (!focus) return null;
  if (focus.startsWith("MCH-")) return { kind: "machine", id: focus };
  if (focus.startsWith("OP-")) return { kind: "operator", id: focus };
  if (focus.startsWith("EVT-")) return { kind: "sos", id: focus };
  if (focus.startsWith("Z-")) return { kind: "zone", id: focus };
  return null;
}

/** Live map — spec §5.5. Full-bleed, panels float over the map. */
export function MapView() {
  const { data: machines } = useMachines();
  const { data: operators } = useOperators();
  const { data: zones } = useZones();
  const { data: alerts } = useAlerts();
  const lookup = useLookup();

  const [focus, setFocus] = useQueryParam("focus");
  const selection = selectionFromFocus(focus);
  const setSelection = (s: MapSelection) => setFocus(s?.id ?? null);

  const [layers, setLayers] = useState<Record<MapLayer, boolean>>({
    machines: true,
    operators: true,
    work: true,
    restricted: true,
    sos: true,
  });
  const [listOpen, setListOpen] = useState(true);

  const ready = machines && operators && zones && alerts;
  const sos = (alerts ?? []).filter((a) => a.category === "emergency" && a.status !== "resolved" && a.position);

  return (
    <div className="relative h-full min-h-[560px] overflow-hidden bg-(--map-land)">
      {ready ? (
        <div className={cn("absolute inset-y-0 right-0 left-0 pt-10 pb-16 transition-[left]", listOpen && "md:left-[19.5rem]")}>
          <SiteMap
            machines={machines}
            operators={operators}
            zones={zones}
            alerts={alerts}
            layers={layers}
            selection={selection}
            onSelect={setSelection}
          />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <Skeleton className="absolute inset-0 rounded-none opacity-40" />
          <p className="relative text-small text-muted-foreground">Loading map…</p>
        </div>
      )}

      {ready ? (
        <>
          {/* Left: entity list */}
          <div className="pointer-events-none absolute inset-y-3 left-3 flex flex-col gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="pointer-events-auto w-fit shadow-lg"
              onClick={() => setListOpen((o) => !o)}
              aria-expanded={listOpen}
            >
              {listOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
              {listOpen ? "Hide list" : "Show list"}
            </Button>
            {listOpen ? (
              <EntityListPanel
                machines={machines}
                operators={operators}
                sos={sos}
                selection={selection}
                onSelect={setSelection}
                className="pointer-events-auto min-h-0 flex-1"
              />
            ) : null}
          </div>

          {/* Right: layers + selection drawer */}
          <div className="pointer-events-none absolute inset-y-3 right-3 flex flex-col items-end gap-3">
            <div className="pointer-events-auto hidden sm:block">
              <LayerPanel
                layers={layers}
                onToggle={(l) => setLayers((s) => ({ ...s, [l]: !s[l] }))}
                counts={{
                  machines: machines.length,
                  operators: operators.filter((o) => o.position && !o.machineId).length,
                  restricted: zones.filter((z) => z.kind === "restricted").length,
                  sos: sos.length,
                }}
              />
            </div>
            {selection ? (
              <div className="pointer-events-auto min-h-0 max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3">
                <MapEntityDrawer
                  selection={selection}
                  machines={machines}
                  operators={operators}
                  lookup={lookup}
                  onClose={() => setSelection(null)}
                />
              </div>
            ) : null}
          </div>

          {/* Bottom: legend + status */}
          <div
            className={cn(
              "pointer-events-none absolute bottom-3 flex flex-wrap items-center gap-3",
              listOpen ? "left-3 md:left-[19.5rem]" : "left-3",
              selection ? "right-3 sm:right-[22rem]" : "right-3",
            )}
          >
            <div className="pointer-events-auto flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-panel px-3 py-2 shadow-lg">
              <MapLegend />
              <span className="hidden h-4 w-px bg-border md:block" aria-hidden />
              <ConnectionStatus />
              <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                <Info className="size-3.5" /> Schematic placeholder for Google Maps
              </span>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
