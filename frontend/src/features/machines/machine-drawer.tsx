"use client";

import Link from "next/link";
import { Fuel, Gauge, LocateFixed, Thermometer, Timer, Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OperatorChip } from "@/components/shared/entity-chip";
import { FatigueIndicator } from "@/components/shared/fatigue-indicator";
import { MachineIcon } from "@/components/shared/machine-icon";
import { MetricCard } from "@/components/shared/metric-card";
import { RelativeTime } from "@/components/shared/relative-time";
import { DrawerSection, RightDrawer } from "@/components/shared/right-drawer";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDuration, formatNumber, formatTime } from "@/lib/format";
import { zoneContaining } from "@/lib/geo";
import { ENGINE_TEMP } from "@/lib/thresholds";
import {
  engineTempTone,
  machineStatusMeta,
  severityMeta,
  taskStatusMeta,
} from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { Machine, SafetyAlert, Zone } from "@/lib/types";
import { MachineTempChart } from "./machine-temp-chart";

interface MachineDrawerProps {
  machine: Machine | undefined;
  alerts: SafetyAlert[];
  zones: Zone[];
  lookup: EntityLookup;
  onClose: () => void;
}

/** Machine detail panel — spec §5.4: live telemetry, location, operator, task, events. */
export function MachineDrawer({ machine: m, alerts, zones, lookup, onClose }: MachineDrawerProps) {
  const operator = lookup.operator(m?.operatorId);
  const task = lookup.task(m?.taskId);
  const stale = m?.status === "offline";
  const events = m ? alerts.filter((a) => a.machineId === m.id) : [];
  const zone = m ? zoneContaining(m.position, zones) : undefined;

  return (
    <RightDrawer
      open={Boolean(m)}
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={
        m ? (
          <span className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md border bg-raised text-foreground-secondary">
              <MachineIcon type={m.type} width={24} height={24} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-mono">{m.id}</span>
              <span className="text-small font-normal text-muted-foreground">{m.model}</span>
            </span>
          </span>
        ) : (
          ""
        )
      }
      meta={
        m ? (
          <>
            <StatusBadge meta={machineStatusMeta[m.status]} />
            <span className="text-caption text-muted-foreground">
              {m.type}
              {zone ? ` · ${zone.name}` : ""} · updated <RelativeTime iso={m.lastSeen} />
            </span>
          </>
        ) : undefined
      }
      footer={
        m ? (
          <>
            <Button variant="ghost" onClick={() => toast.info(`Fault report for ${m.id}`, { description: "Reporting is not connected yet." })}>
              <Wrench /> Report fault
            </Button>
            <Button asChild>
              <Link href={`/map?focus=${m.id}`}>
                <LocateFixed /> Locate on map
              </Link>
            </Button>
          </>
        ) : undefined
      }
    >
      {m ? (
        <div className="flex flex-col divide-y">
          <DrawerSection title="Live telemetry">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard size="sm" label="Velocity" icon={Gauge} value={m.velocityKph.toFixed(1)} unit="km/h" stale={stale} />
              <MetricCard
                size="sm"
                label="Engine"
                icon={Thermometer}
                value={m.engineTempC}
                unit="°C"
                tone={engineTempTone(m.engineTempC, ENGINE_TEMP)}
                stale={stale}
              />
              <MetricCard
                size="sm"
                label="Runtime"
                icon={Timer}
                value={m.runtimeTodayMin != null ? formatDuration(m.runtimeTodayMin) : "—"}
                sub={m.engineHours != null ? `${formatNumber(m.engineHours)} h total` : "No lifetime hours on file"}
                stale={stale}
              />
              <MetricCard
                size="sm"
                label="Fuel"
                icon={Fuel}
                value={m.fuelPct ?? "—"}
                unit={m.fuelPct != null ? "%" : undefined}
                tone={m.fuelPct != null && m.fuelPct < 15 ? "warning" : null}
                stale={stale}
              />
            </div>
          </DrawerSection>

          <DrawerSection title="Engine temperature — last 2 h">
            {stale ? (
              <p className="text-small text-muted-foreground">No telemetry since {formatTime(m.lastSeen)}.</p>
            ) : (
              <MachineTempChart machine={m} />
            )}
          </DrawerSection>

          <DrawerSection title="Current operator">
            {operator ? (
              <Link href={`/operators?operator=${operator.id}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:border-border-strong">
                <OperatorChip operator={operator} />
                <FatigueIndicator score={operator.fatigue} />
              </Link>
            ) : (
              <p className="text-small text-muted-foreground">No operator assigned</p>
            )}
          </DrawerSection>

          <DrawerSection title="Current task">
            {task ? (
              <Link href={`/tasks?task=${task.id}`} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 hover:border-border-strong">
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-small font-medium">{task.title}</span>
                  <span className="font-mono text-caption text-muted-foreground">
                    {task.id}
                    {task.start ? ` · ${formatTime(task.start)} · ${formatDuration(task.durationMin)}` : ""}
                  </span>
                </span>
                <StatusBadge meta={taskStatusMeta[task.status]} size="sm" />
              </Link>
            ) : (
              <p className="text-small text-muted-foreground">No active task</p>
            )}
          </DrawerSection>

          <DrawerSection title="Recent events">
            {events.length ? (
              <ul className="flex flex-col gap-1.5">
                {events.map((a) => {
                  const sev = severityMeta[a.severity];
                  return (
                    <li key={a.id}>
                      <Link href={`/safety?event=${a.id}`} className="flex items-center gap-3 rounded-md border px-3 py-2 hover:border-border-strong">
                        <StatusBadge meta={sev} size="sm" variant="plain" />
                        <span className="min-w-0 flex-1 truncate text-small">{a.title}</span>
                        <RelativeTime iso={a.raisedAt} className="text-caption text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-small text-muted-foreground">No events in the last 7 days</p>
            )}
          </DrawerSection>
        </div>
      ) : null}
    </RightDrawer>
  );
}
