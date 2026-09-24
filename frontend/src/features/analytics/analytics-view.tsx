"use client";

import { useMemo } from "react";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { PageContainer } from "@/components/shared/page-container";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import {
  useRunList,
  useRunMachines,
  useRunPortions,
  useRunSummary,
  useRunWorkers,
} from "@/hooks/use-fleet-data";
import { formatDate, formatDuration, formatPercent } from "@/lib/format";
import { taskTypeLabel } from "@/lib/status";
import { UtilizationChart, WorkloadChart } from "../dashboard/dashboard-charts";
import { BreakdownList } from "./breakdown-list";

/**
 * Analytics — spec §5.8: trends for planning decisions.
 *
 * There is no multi-day history in the backend: only one published plan at a
 * time, plus a history of past runs. So there is no "last 7/14/30 days"
 * picker and no "vs. previous period" comparison here — those would have had
 * to be invented (the previous version of this page did invent them). The
 * real substitute for a trend is comparing across published RUNS, shown at
 * the bottom of this page.
 */
export function AnalyticsView() {
  const { data: run, isPending: runPending } = useRunSummary();
  const { data: portions } = useRunPortions();
  const { data: workers } = useRunWorkers();
  const { data: machines } = useRunMachines();
  const { data: runHistory } = useRunList();

  const taskTypeBreakdown = useMemo(() => {
    if (!portions) return [];
    const counts = new Map<string, number>();
    for (const p of portions) counts.set(p.task_type, (counts.get(p.task_type) ?? 0) + 1);
    return [...counts.entries()]
      .map(([type, count]) => ({ label: taskTypeLabel[type as keyof typeof taskTypeLabel] ?? type, value: count }))
      .sort((a, b) => b.value - a.value);
  }, [portions]);

  const topWorkers = useMemo(
    () => [...(workers ?? [])].sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 8),
    [workers],
  );
  const topMachines = useMemo(
    () => [...(machines ?? [])].sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 8),
    [machines],
  );

  if (runPending) {
    return (
      <PageContainer className="flex flex-col gap-4">
        <PageHeader title="Analytics" description="This plan" />
        <TableSkeleton rows={8} columns={3} />
      </PageContainer>
    );
  }

  if (!run) {
    return (
      <PageContainer className="flex flex-col gap-4">
        <PageHeader title="Analytics" description="This plan" />
        <EmptyState
          variant="clear"
          title="No published plan yet"
          description="Publish a schedule from Tasks and every chart here fills in from the solver's own output."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="flex flex-col gap-4">
      <PageHeader
        title="Analytics"
        description={
          <>
            {run.label ?? run.id.slice(0, 8)} · published {formatDate(run.created_at)}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <KpiCard label="Tasks in plan" value={run.n_tasks} denominator={run.n_portions !== run.n_tasks ? run.n_portions : undefined} info="Tasks scheduled; denominator shown only when tasks split into multiple portions." />
        <KpiCard label="Makespan" value={formatDuration(run.makespan_min)} info="Time from plan start to the last task finishing." />
        <KpiCard
          label="Resources used"
          value={`${run.workers_used}+${run.machines_used}`}
          denominator={run.workers_total + run.machines_total}
          info="Workers + machines engaged by this plan, out of the full roster."
        />
        <KpiCard
          label="Solver check"
          value={run.verified ? "Verified" : "Unverified"}
          tone={run.verified ? "success" : "danger"}
          info="Every constraint independently re-checked against the roster after solving."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-7">
          <UtilizationChart />
        </div>
        <div className="min-w-0 xl:col-span-5">
          <SectionCard title="Tasks by type" subtitle="Portions in this plan" className="h-full">
            {taskTypeBreakdown.length ? (
              <BreakdownList items={taskTypeBreakdown} />
            ) : (
              <p className="text-small text-muted-foreground">No portions in this plan.</p>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-12">
          <WorkloadChart />
        </div>

        <div className="min-w-0 xl:col-span-6">
          <SectionCard title="Busiest operators" subtitle="By utilisation, this plan" bodyClassName="p-0" className="h-full">
            {topWorkers.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="border-b">
                      <th className="eyebrow px-4 py-2 text-left">Worker</th>
                      <th className="eyebrow px-4 py-2 text-right">Tasks</th>
                      <th className="eyebrow px-4 py-2 text-right">Busy</th>
                      <th className="eyebrow px-4 py-2 text-right">Peak fatigue</th>
                      <th className="eyebrow px-4 py-2 text-right">Util.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {topWorkers.map((w) => (
                      <tr key={w.worker_id} className="hover:bg-raised">
                        <td className="px-4 py-2 font-mono">{w.worker_id}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{w.n_tasks}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatDuration(w.busy_min)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{w.peak_fatigue}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatPercent(w.utilization_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-small text-muted-foreground">No workers in this plan.</p>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-6">
          <SectionCard title="Busiest machines" subtitle="By utilisation, this plan" bodyClassName="p-0" className="h-full">
            {topMachines.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="border-b">
                      <th className="eyebrow px-4 py-2 text-left">Machine</th>
                      <th className="eyebrow px-4 py-2 text-right">Tasks</th>
                      <th className="eyebrow px-4 py-2 text-right">Busy</th>
                      <th className="eyebrow px-4 py-2 text-right">Peak temp</th>
                      <th className="eyebrow px-4 py-2 text-right">Util.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {topMachines.map((m) => (
                      <tr key={m.machine_id} className="hover:bg-raised">
                        <td className="px-4 py-2 font-mono">{m.machine_id}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{m.n_tasks}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatDuration(m.busy_min)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{m.peak_temp_c}°C</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatPercent(m.utilization_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-small text-muted-foreground">No machines in this plan.</p>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-12">
          <SectionCard title="Plan history" subtitle="Every run the solver has produced" bodyClassName="p-0">
            {runHistory && runHistory.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-small">
                  <thead>
                    <tr className="border-b">
                      <th className="eyebrow px-4 py-2 text-left">Run</th>
                      <th className="eyebrow px-4 py-2 text-left">Published</th>
                      <th className="eyebrow px-4 py-2 text-right">Makespan</th>
                      <th className="eyebrow px-4 py-2 text-right">Tasks</th>
                      <th className="eyebrow px-4 py-2 text-right">Improvement vs. greedy</th>
                      <th className="eyebrow px-4 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {runHistory.map((r) => (
                      <tr key={r.id} className={r.id === run.id ? "bg-brand-subtle" : "hover:bg-raised"}>
                        <td className="px-4 py-2">
                          <span className="truncate">{r.label ?? r.id.slice(0, 8)}</span>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{formatDate(r.created_at)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{formatDuration(r.makespan_min)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">{r.n_tasks}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {formatPercent(r.improvement_vs_greedy_pct)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <StatusBadge
                            tone={r.status === "PUBLISHED" ? "success" : r.status === "ARCHIVED" ? "neutral" : "info"}
                            label={r.status}
                            size="sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-small text-muted-foreground">No run history yet.</p>
            )}
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}
