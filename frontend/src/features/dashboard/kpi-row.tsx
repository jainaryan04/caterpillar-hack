"use client";

import { KpiCard } from "@/components/shared/kpi-card";
import { KpiRowSkeleton } from "@/components/shared/loading-skeleton";
import { useRunUtilization } from "@/hooks/use-fleet-data";
import type { Machine, Operator, SafetyAlert, Task } from "@/lib/types";

interface KpiRowProps {
  machines?: Machine[];
  operators?: Operator[];
  tasks?: Task[];
  alerts?: SafetyAlert[];
}

/**
 * Six KPI tiles — spec §5.1 / §15. Each links to the filtered list behind it.
 *
 * No deltas or sparklines here. The first five tiles read live status, and the
 * backend keeps no history of those counts, so "vs. yesterday" would have to
 * be invented — it previously was, as a hardcoded string that never changed.
 * Utilisation is the one figure with a real source: the published run's own
 * rollup.
 */
export function KpiRow({ machines, operators, tasks, alerts }: KpiRowProps) {
  const { data: util } = useRunUtilization();
  if (!machines || !operators || !tasks || !alerts) return <KpiRowSkeleton />;

  const activeMachines = machines.filter((m) => m.status === "operating" || m.status === "idle").length;
  const activeOperators = operators.filter((o) => o.availability === "on-task").length;
  const inProgress = tasks.filter((t) => t.status === "in-progress").length;
  const delayed = tasks.filter((t) => t.status === "delayed").length;
  const openSos = alerts.filter((a) => a.category === "emergency" && a.status === "open").length;
  const activeSos = alerts.filter((a) => a.category === "emergency" && a.status !== "resolved").length;
  const machineRatio = machines.length ? activeMachines / machines.length : 0;
  const utilization = util?.summary.mean_utilization_pct;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-6">
      <KpiCard
        label="Active machines"
        value={activeMachines}
        denominator={machines.length}
        tone={machineRatio < 0.7 ? "warning" : "default"}
        href="/machines"
        info="Machines operating or idle with the engine available. Excludes fault, maintenance and offline."
      />
      <KpiCard
        label="Active operators"
        value={activeOperators}
        denominator={operators.length}
        href="/operators"
        info="Operators currently on a task, out of the full roster."
      />
      <KpiCard label="Tasks in progress" value={inProgress} href="/tasks" />
      <KpiCard
        label="Delayed tasks"
        value={delayed}
        tone={delayed > 0 ? "warning" : "success"}
        caption={delayed === 0 ? "None delayed" : undefined}
        href="/tasks?status=delayed"
        info="Tasks running past their planned end time."
      />
      <KpiCard
        label="SOS alerts"
        value={activeSos}
        tone={activeSos > 0 ? "danger" : "success"}
        pulse={openSos > 0}
        caption={
          activeSos === 0 ? "All clear" : openSos > 0 ? `${openSos} unacknowledged` : "All acknowledged"
        }
        href="/safety"
      />
      <KpiCard
        label="Plan utilisation"
        value={utilization ?? "—"}
        unit={utilization != null ? "%" : undefined}
        tone={utilization == null ? "default" : utilization < 75 ? "warning" : "brand"}
        caption={
          util ? `${util.summary.resources_used}/${util.summary.resources_total} engaged` : "No published plan"
        }
        href="/analytics"
        info="Mean busy time ÷ makespan across every machine and operator in the published plan."
      />
    </div>
  );
}
