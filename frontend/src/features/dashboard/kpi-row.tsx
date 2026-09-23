"use client";

import { KpiCard } from "@/components/shared/kpi-card";
import { KpiRowSkeleton } from "@/components/shared/loading-skeleton";
import { kpiSparklines } from "@/lib/mock/analytics";
import type { Machine, Operator, SafetyAlert, Task } from "@/lib/types";

interface KpiRowProps {
  machines?: Machine[];
  operators?: Operator[];
  tasks?: Task[];
  alerts?: SafetyAlert[];
}

/** Six KPI tiles — spec §5.1 / §15. Each links to the filtered list behind it. */
export function KpiRow({ machines, operators, tasks, alerts }: KpiRowProps) {
  if (!machines || !operators || !tasks || !alerts) return <KpiRowSkeleton />;

  const activeMachines = machines.filter((m) => m.status === "operating" || m.status === "idle").length;
  const onShift = operators.filter((o) => o.shift?.name === "Day" && o.availability !== "leave").length;
  const activeOperators = operators.filter((o) => o.availability === "on-task").length;
  const inProgress = tasks.filter((t) => t.status === "in-progress").length;
  const delayed = tasks.filter((t) => t.status === "delayed").length;
  const openSos = alerts.filter((a) => a.category === "emergency" && a.status === "open").length;
  const activeSos = alerts.filter((a) => a.category === "emergency" && a.status !== "resolved").length;
  const utilization = kpiSparklines.utilization.at(-1) ?? 0;
  const machineRatio = activeMachines / machines.length;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-6">
      <KpiCard
        label="Active machines"
        value={activeMachines}
        denominator={machines.length}
        tone={machineRatio < 0.7 ? "warning" : "default"}
        delta={{ text: "+2 vs. yesterday", direction: "up", good: true }}
        sparkline={kpiSparklines.activeMachines}
        href="/machines"
        info="Machines operating or idle with the engine available. Excludes fault, maintenance and offline."
      />
      <KpiCard
        label="Active operators"
        value={activeOperators}
        denominator={onShift}
        delta={{ text: "same as yesterday", direction: "flat", good: true }}
        sparkline={kpiSparklines.activeOperators}
        href="/operators"
        info="Operators currently on a task, out of those rostered on this shift."
      />
      <KpiCard
        label="Tasks in progress"
        value={inProgress}
        delta={{ text: "+1 vs. yesterday", direction: "up", good: true }}
        sparkline={kpiSparklines.tasksInProgress}
        href="/tasks"
      />
      <KpiCard
        label="Delayed tasks"
        value={delayed}
        tone={delayed > 0 ? "warning" : "success"}
        caption={delayed === 0 ? "None delayed" : undefined}
        delta={delayed > 0 ? { text: "+1 vs. yesterday", direction: "up", good: false } : undefined}
        sparkline={kpiSparklines.delayedTasks}
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
        label="Fleet utilization"
        value={utilization}
        unit="%"
        tone={utilization < 75 ? "warning" : "brand"}
        delta={{ text: "+4 pts vs. yesterday", direction: "up", good: true }}
        sparkline={kpiSparklines.utilization}
        href="/analytics"
        info="Engine-on productive hours ÷ scheduled available hours. Target 75%."
      />
    </div>
  );
}
