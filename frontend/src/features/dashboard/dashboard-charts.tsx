"use client";

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
import {
  CHART,
  ChartLegend,
  ChartTooltipContent,
  axisProps,
  barCursorProps,
  cursorProps,
  gridProps,
} from "@/components/charts/chart-primitives";
import { dailySeries, shiftUtilization } from "@/lib/mock/analytics";

/** Fleet utilization over the current shift with the 75% target — spec §5.1. */
export function UtilizationChart() {
  return (
    <SectionCard
      title="Fleet utilization — this shift"
      subtitle="Hourly, engine-on productive hours ÷ available hours"
      action={
        <ChartLegend
          items={[
            { label: "Utilization", color: CHART.series[0] },
            { label: "Target 75%", color: CHART.reference, dashed: true },
          ]}
          className="hidden sm:flex"
        />
      }
      className="h-full"
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={shiftUtilization} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="util-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.series[0]} stopOpacity={0.25} />
                <stop offset="100%" stopColor={CHART.series[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="hour" {...axisProps} interval={1} />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...axisProps} unit="%" />
            <Tooltip cursor={cursorProps} content={<ChartTooltipContent unit="%" />} />
            <ReferenceLine y={75} stroke={CHART.reference} strokeDasharray="4 4" />
            <Area
              type="monotone"
              dataKey="utilization"
              name="Utilization"
              stroke={CHART.series[0]}
              strokeWidth={2}
              fill="url(#util-fill)"
              connectNulls={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}

/** Completed tasks per day, on-time vs late — last 14 days. */
export function ThroughputChart() {
  const data = dailySeries.slice(-14);
  return (
    <SectionCard
      title="Task throughput — 14 days"
      subtitle="Completed tasks per day"
      action={
        <ChartLegend
          items={[
            { label: "On time", color: CHART.series[1] },
            { label: "Late", color: CHART.status.warning },
          ]}
          className="hidden sm:flex"
        />
      }
      className="h-full"
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" {...axisProps} interval={1} />
            <YAxis {...axisProps} allowDecimals={false} />
            <Tooltip cursor={barCursorProps} content={<ChartTooltipContent />} />
            <Bar dataKey="onTime" name="On time" stackId="a" fill={CHART.series[1]} isAnimationActive={false} />
            <Bar dataKey="late" name="Late" stackId="a" fill={CHART.status.warning} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </SectionCard>
  );
}
