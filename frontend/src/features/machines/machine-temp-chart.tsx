"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, ChartTooltipContent, axisProps, cursorProps, gridProps } from "@/components/charts/chart-primitives";
import { EmptyState } from "@/components/shared/empty-state";
import { ChartSkeleton } from "@/components/shared/loading-skeleton";
import { ENGINE_TEMP } from "@/lib/thresholds";
import { useMachineState } from "@/hooks/use-fleet-data";
import type { Machine } from "@/lib/types";

/**
 * Engine temperature across the published plan, with elevated / critical
 * bands — spec §5.4.
 *
 * These are the scheduling engine's own thermal projections for this machine
 * (`resource_state_samples`), sampled in minutes from the run's horizon. The
 * live telemetry feed does not touch engine_temp_c, so there is no rolling
 * "last 2 hours" of real readings to plot — this is the real curve that
 * exists, rather than a synthetic one shaped to look like one.
 */
export function MachineTempChart({ machine }: { machine: Machine }) {
  const { data: samples, isPending } = useMachineState();

  const data = useMemo(
    () =>
      (samples ?? [])
        .filter((s) => s.resource_id === machine.id)
        .sort((a, b) => a.t_min - b.t_min)
        .map((s) => ({ h: Math.round((s.t_min / 60) * 10) / 10, temp: Math.round(s.value * 10) / 10 })),
    [samples, machine.id],
  );

  if (isPending) return <ChartSkeleton className="h-44" />;
  if (data.length === 0) {
    return (
      <EmptyState
        title="No thermal projection"
        description={`${machine.id} is not part of the published plan.`}
      />
    );
  }

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <ReferenceArea y1={ENGINE_TEMP.elevated} y2={ENGINE_TEMP.critical} fill={CHART.status.warning} fillOpacity={0.08} />
          <ReferenceArea y1={ENGINE_TEMP.critical} y2={120} fill={CHART.status.danger} fillOpacity={0.08} />
          <XAxis dataKey="h" {...axisProps} unit="h" interval="preserveStartEnd" />
          <YAxis domain={[40, 120]} ticks={[40, 60, 80, 95, 105, 120]} {...axisProps} />
          <Tooltip
            cursor={cursorProps}
            content={<ChartTooltipContent unit=" °C" labelFormatter={(l) => `${l} h into the plan`} />}
          />
          <Line
            type="monotone"
            dataKey="temp"
            name="Engine temp"
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
