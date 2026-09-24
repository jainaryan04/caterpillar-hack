"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, Siren, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MachineChip, OperatorChip } from "@/components/shared/entity-chip";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { MetricCard } from "@/components/shared/metric-card";
import { RelativeTime } from "@/components/shared/relative-time";
import { ShiftProgress } from "@/components/shared/shift-progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDuration } from "@/lib/format";
import { pointInPolygon, zoneContaining } from "@/lib/geo";
import { ENGINE_TEMP } from "@/lib/thresholds";
import { alertStatusMeta, availabilityMeta, engineTempTone, machineStatusMeta } from "@/lib/status";
import { useAcknowledgeAlert, type EntityLookup } from "@/hooks/use-fleet-data";
import type { Machine, Operator, Zone } from "@/lib/types";
import { toPlan, type MapSelection } from "./site-map";

/** Plan units → metres (site is ~3.4 km across 1000 units). */
const METRES_PER_UNIT = 3.37;

interface MapEntityDrawerProps {
  selection: NonNullable<MapSelection>;
  machines: Machine[];
  operators: Operator[];
  zones: Zone[];
  lookup: EntityLookup;
  onClose: () => void;
}

function Panel({ title, children, onClose, footer, accent }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode; accent?: boolean }) {
  return (
    <section
      className={cn(
        "flex max-h-full w-full flex-col overflow-hidden rounded-lg border bg-panel shadow-xl sm:w-[340px]",
        accent && "border-danger",
      )}
      aria-label="Selected item"
    >
      <div className="flex items-start justify-between gap-2 border-b p-3">
        <div className="min-w-0 flex-1">{title}</div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">{children}</div>
      {footer ? <div className="flex flex-wrap justify-end gap-2 border-t p-3">{footer}</div> : null}
    </section>
  );
}

/** Map selection drawer — spec §13: machine, operator, zone and SOS variants. */
export function MapEntityDrawer({ selection, machines, operators, zones, lookup, onClose }: MapEntityDrawerProps) {
  const acknowledgeAlert = useAcknowledgeAlert();

  if (selection.kind === "machine") {
    const m = lookup.machine(selection.id);
    if (!m) return null;
    const operator = lookup.operator(m.operatorId);
    const task = lookup.task(m.taskId);
    return (
      <Panel
        onClose={onClose}
        title={
          <div className="flex flex-col gap-1.5">
            <MachineChip machine={m} />
            <StatusBadge meta={machineStatusMeta[m.status]} size="sm" />
          </div>
        }
        footer={
          <Button asChild size="sm" variant="secondary">
            <Link href={`/machines?machine=${m.id}`}>
              Open details <ExternalLink />
            </Link>
          </Button>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          <MetricCard size="sm" label="km/h" value={m.velocityKph.toFixed(1)} stale={m.status === "offline"} />
          <MetricCard size="sm" label="°C" value={m.engineTempC} tone={engineTempTone(m.engineTempC, ENGINE_TEMP)} stale={m.status === "offline"} />
          <MetricCard size="sm" label="Runtime" value={m.runtimeTodayMin != null ? formatDuration(m.runtimeTodayMin) : "—"} stale={m.status === "offline"} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-small">
          <dt className="text-muted-foreground">Operator</dt>
          <dd className="truncate">{operator?.id ?? "—"}</dd>
          <dt className="text-muted-foreground">Task</dt>
          <dd className="truncate">{task ? `${task.id} · ${task.title}` : "—"}</dd>
          <dt className="text-muted-foreground">Zone</dt>
          <dd>{zoneContaining(m.position, zones)?.name ?? "—"}</dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd>
            <RelativeTime iso={m.lastSeen} />
          </dd>
        </dl>
      </Panel>
    );
  }

  if (selection.kind === "operator") {
    const o = lookup.operator(selection.id);
    if (!o) return null;
    return (
      <Panel
        onClose={onClose}
        title={
          <div className="flex flex-col gap-1.5">
            <OperatorChip operator={o} />
            <StatusBadge meta={availabilityMeta[o.availability]} size="sm" />
          </div>
        }
        footer={
          <>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/operators?operator=${o.id}`}>
                Open profile <ExternalLink />
              </Link>
            </Button>
          </>
        }
      >
        <ShiftProgress shift={o.shift} hoursWorked={o.hoursWorked} plannedHours={o.plannedHours} />
        <div className="flex items-center justify-between text-small">
          <span className="text-muted-foreground">Fatigue</span>
          <FatigueIndicator score={o.fatigue} showLabel />
        </div>
      </Panel>
    );
  }

  if (selection.kind === "zone") {
    const z = lookup.zone(selection.id);
    if (!z) return null;
    const inside = machines.filter((m) => pointInPolygon(m.position, z.polygon));
    return (
      <Panel
        onClose={onClose}
        accent={z.kind === "restricted"}
        title={
          <div className="flex flex-col gap-1">
            <h3 className="text-h3">{z.name}</h3>
            {z.kind === "restricted" ? (
              <StatusBadge tone="danger" label={`Restricted${z.activeWindow ? ` · ${z.activeWindow}` : ""}`} size="sm" />
            ) : (
              <StatusBadge tone="neutral" label="Work area" size="sm" />
            )}
          </div>
        }
      >
        {z.rule ? <p className="text-small text-foreground-secondary">{z.rule}</p> : null}
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Machines in zone ({inside.length})</h4>
          {inside.length ? (
            <ul className="flex flex-col gap-1">
              {inside.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <MachineChip machine={m} size="sm" />
                  <StatusBadge meta={machineStatusMeta[m.status]} size="sm" variant="plain" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted-foreground">None</p>
          )}
        </div>
      </Panel>
    );
  }

  const a = lookup.alert(selection.id);
  if (!a || !a.position) return null;
  const who = lookup.operator(a.operatorId);
  const origin = toPlan(a.position);
  const responders = operators
    .filter((o) => o.position && o.id !== a.operatorId && o.availability !== "off-shift" && o.availability !== "leave")
    .map((o) => {
      const p = toPlan(o.position!);
      return { o, metres: Math.round(Math.hypot(p.x - origin.x, p.y - origin.y) * METRES_PER_UNIT) };
    })
    .sort((x, y) => x.metres - y.metres)
    .slice(0, 3);

  return (
    <Panel
      onClose={onClose}
      accent
      title={
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-small font-semibold text-danger">
            <Siren className="size-4" /> SOS · {a.id}
          </span>
          <h3 className="text-h3">{a.title}</h3>
          <StatusBadge meta={alertStatusMeta[a.status]} size="sm" />
        </div>
      }
      footer={
        <>
          <Button asChild size="sm" variant="secondary">
            <Link href={`/safety?event=${a.id}`}>Open event</Link>
          </Button>
          {a.status === "open" ? (
            <Button
              size="sm"
              variant="critical"
              onClick={() =>
                acknowledgeAlert.mutate({ id: a.id }, { onSuccess: () => toast.success(`${a.id} acknowledged`) })
              }
            >
              Acknowledge
            </Button>
          ) : null}
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-small">
        <dt className="text-muted-foreground">Person</dt>
        <dd>{who?.id ?? "Unknown"}</dd>
        <dt className="text-muted-foreground">Location</dt>
        <dd>{lookup.zone(a.zoneId)?.name}</dd>
        <dt className="text-muted-foreground">Elapsed</dt>
        <dd className="font-mono text-danger">
          <RelativeTime iso={a.raisedAt} mode="elapsed" />
        </dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">Nearest responders</h4>
        <ul className="flex flex-col gap-1">
          {responders.map(({ o, metres }) => (
            <li key={o.id} className="flex items-center justify-between gap-2">
              <OperatorChip operator={o} size="sm" />
              <span className="font-mono text-caption text-muted-foreground">{metres} m</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
