"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART,
  ChartTooltipContent,
  axisProps,
  barCursorProps,
  cursorProps,
  gridProps,
} from "@/components/charts/chart-primitives";
import type { DailyPoint } from "@/lib/mock/analytics";
import { durationStats } from "@/lib/mock/analytics";
import { taskTypeLabel } from "@/lib/status";

const H = "h-72";

export function ProductivityChart({ data, compare }: { data: DailyPoint[]; compare: boolean }) {
  return (
    <div className={H}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip cursor={cursorProps} content={<ChartTooltipContent />} />
          {compare ? (
            <Line
              type="monotone"
              dataKey="prevTasksCompleted"
              name="Previous period"
              stroke={CHART.reference}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ) : null}
          <Line
            type="monotone"
            dataKey="tasksCompleted"
            name="Tasks completed"
            stroke={CHART.series[0]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked hours by machine state — status colors, since state is the point. */
export function UtilizationHoursChart({ data }: { data: DailyPoint[] }) {
  const series = [
    { key: "operatingH", name: "Operating", color: CHART.status.success },
    { key: "idleH", name: "Idle", color: CHART.series[5] },
    { key: "maintenanceH", name: "Maintenance", color: CHART.status.info },
    { key: "faultH", name: "Fault", color: CHART.status.danger },
  ];
  return (
    <div className={H}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} unit="h" />
          <Tooltip cursor={cursorProps} content={<ChartTooltipContent unit=" h" />} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stackId="1"
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.35}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function UtilizationTrendChart({ data, compare }: { data: DailyPoint[]; compare: boolean }) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} minTickGap={24} />
          <YAxis domain={[40, 100]} {...axisProps} unit="%" />
          <Tooltip cursor={cursorProps} content={<ChartTooltipContent unit="%" />} />
          <ReferenceLine y={75} stroke={CHART.reference} strokeDasharray="4 4" />
          {compare ? (
            <Line type="monotone" dataKey="prevUtilization" name="Previous period" stroke={CHART.reference} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
          ) : null}
          <Line type="monotone" dataKey="utilization" name="Utilization" stroke={CHART.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompletionChart({ data }: { data: DailyPoint[] }) {
  return (
    <div className={H}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid {...gridProps} />
          <XAxis dataKey="date" {...axisProps} minTickGap={24} />
          <YAxis {...axisProps} allowDecimals={false} />
          <Tooltip cursor={barCursorProps} content={<ChartTooltipContent />} />
          <Bar dataKey="onTime" name="On time" stackId="a" fill={CHART.series[1]} isAnimationActive={false} />
          <Bar dataKey="late" name="Late" stackId="a" fill={CHART.status.warning} isAnimationActive={false} />
          <Bar dataKey="cancelled" name="Cancelled" stackId="a" fill={CHART.series[5]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DurationChart() {
  const data = durationStats.map((d) => ({ ...d, label: taskTypeLabel[d.type] }));
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 24, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid stroke={CHART.grid} horizontal={false} />
          <XAxis type="number" {...axisProps} unit="m" />
          <YAxis type="category" dataKey="label" {...axisProps} width={84} />
          <Tooltip cursor={barCursorProps} content={<ChartTooltipContent unit=" min" />} />
          <Bar dataKey="planned" name="Planned" fill={CHART.series[5]} fillOpacity={0.6} isAnimationActive={false} />
          <Bar dataKey="median" name="Median actual" fill={CHART.series[0]} isAnimationActive={false} />
          <Bar dataKey="p90" name="P90 actual" fill={CHART.series[3]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
