"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";
import {
  CHART,
  ChartLegend,
  ChartTooltipContent,
  axisProps,
  barCursorProps,
  cursorProps,
  gridProps,
} from "@/components/charts/chart-primitives";
import { useRunPortions, useRunSummary, useRunUtilization } from "@/hooks/use-fleet-data";
import type { ScheduledPortion } from "@/lib/api/client";

const NO_PLAN = {
  title: "No published plan",
  description: "Publish a schedule and this fills in from the solver's own output.",
} as const;

/**
 * Real utilisation per machine type, straight from the published run's
 * `/utilization` rollup (busy_min ÷ makespan, computed backend-side). This
 * replaced a synthetic hourly curve — the backend has no hour-by-hour
 * utilisation history, so showing one would have been an invention.
 */
export function UtilizationChart() {
  const { data: util, isPending } = useRunUtilization();

  const data = useMemo(() => {
    if (!util) return [];
    const byType = new Map<string, { total: number; n: number }>();
    for (const r of util.resources) {
      if (r.kind !== "machine") continue;
      const acc = byType.get(r.detail) ?? { total: 0, n: 0 };
      acc.total += r.utilization_pct;
      acc.n += 1;
      byType.set(r.detail, acc);
    }
    return [...byType.entries()]
      .map(([type, { total, n }]) => ({
        type,
        utilization: Math.round((total / n) * 10) / 10,
        count: n,
      }))
      .sort((a, b) => b.utilization - a.utilization);
  }, [util]);

  const mean = util?.summary.mean_utilization_pct ?? 0;

  return (
    <SectionCard
      title="Machine utilisation — this plan"
      subtitle={
        util
          ? `Busy time ÷ makespan, averaged per machine type · fleet mean ${mean}%`
          : "Busy time ÷ makespan, per machine type"
      }
      action={
        <ChartLegend
          items={[
            { label: "Utilisation", color: CHART.series[0] },
            { label: `Fleet mean ${mean}%`, color: CHART.reference, dashed: true },
          ]}
          className="hidden sm:flex"
        />
      }
      className="h-full"
    >
      <div className="h-64">
        {isPending ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <EmptyState {...NO_PLAN} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="type" {...axisProps} interval={0} tick={{ fill: CHART.axis, fontSize: 10 }} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} unit="%" />
              <Tooltip cursor={barCursorProps} content={<ChartTooltipContent unit="%" />} />
              <ReferenceLine y={mean} stroke={CHART.reference} strokeDasharray="4 4" />
              <Bar
                dataKey="utilization"
                name="Utilisation"
                fill={CHART.series[0]}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  );
}

/** Portions running at the same time at each point in the plan. */
function concurrencyProfile(portions: ScheduledPortion[], makespanMin: number) {
  if (!portions.length || makespanMin <= 0) return [];
  const BUCKETS = 60;
  const step = makespanMin / BUCKETS;
  return Array.from({ length: BUCKETS + 1 }, (_, i) => {
    const t = Math.round(i * step);
    return {
      hour: Math.round((t / 60) * 10) / 10,
      active: portions.filter((p) => p.start_min <= t && t < p.end_min).length,
    };
  });
}

/**
 * The shape of the schedule the solver produced: how many portions run
 * concurrently across the horizon. Derived entirely from each portion's real
 * start_min/end_min, so the peaks and the tail-off are the optimiser's own
 * decisions, not a drawn curve.
 */
export function WorkloadChart() {
  const { data: portions, isPending } = useRunPortions();
  const { data: run } = useRunSummary();

  const makespan = run?.makespan_min ?? 0;
  const data = useMemo(() => concurrencyProfile(portions ?? [], makespan), [portions, makespan]);
  const peak = data.reduce((m, d) => Math.max(m, d.active), 0);

  return (
    <SectionCard
      title="Scheduled workload — this plan"
      subtitle={
        run
          ? `Portions running concurrently over a ${Math.round(makespan / 60)} h horizon · peak ${peak}`
          : "Portions running concurrently over the plan horizon"
      }
      action={
        <ChartLegend
          items={[{ label: "Concurrent portions", color: CHART.series[1] }]}
          className="hidden sm:flex"
        />
      }
      className="h-full"
    >
      <div className="h-64">
        {isPending ? (
          <ChartSkeleton />
        ) : data.length === 0 ? (
          <EmptyState {...NO_PLAN} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="workload-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.series[1]} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CHART.series[1]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="hour" {...axisProps} unit="h" interval={9} />
              <YAxis {...axisProps} allowDecimals={false} />
              <Tooltip
                cursor={cursorProps}
                content={<ChartTooltipContent labelFormatter={(l) => `${l} h into the plan`} />}
              />
              <Area
                type="stepAfter"
                dataKey="active"
                name="Concurrent portions"
                stroke={CHART.series[1]}
                strokeWidth={2}
                fill="url(#workload-fill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </SectionCard>
  );
}
