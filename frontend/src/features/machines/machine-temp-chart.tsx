"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART, ChartTooltipContent, axisProps, cursorProps, gridProps } from "@/components/charts/chart-primitives";
import { formatTime } from "@/lib/format";
import { ENGINE_TEMP } from "@/lib/mock/machines";
import { noise } from "@/lib/mock/time";
import type { Machine } from "@/lib/types";

/** Engine temperature, last 2 h, with elevated / critical bands — spec §5.4. */
export function MachineTempChart({ machine }: { machine: Machine }) {
  const data = useMemo(() => {
    const seed = Number(machine.id.slice(-3));
    const end = new Date(machine.lastSeen).getTime();
    const rising = machine.engineTempC >= ENGINE_TEMP.elevated;
    return Array.from({ length: 25 }, (_, i) => {
      const drift = rising ? (i - 24) * 0.7 : 0;
      const temp = machine.status === "offline" ? 0 : machine.engineTempC + drift + (noise(seed + i) - 0.5) * 3;
      return { t: formatTime(new Date(end - (24 - i) * 5 * 60_000)), temp: Math.round(temp * 10) / 10 };
    });
  }, [machine]);

  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid {...gridProps} />
          <ReferenceArea y1={ENGINE_TEMP.elevated} y2={ENGINE_TEMP.critical} fill={CHART.status.warning} fillOpacity={0.08} />
          <ReferenceArea y1={ENGINE_TEMP.critical} y2={120} fill={CHART.status.danger} fillOpacity={0.08} />
          <XAxis dataKey="t" {...axisProps} interval={5} />
          <YAxis domain={[40, 120]} ticks={[40, 60, 80, 95, 105, 120]} {...axisProps} />
          <Tooltip cursor={cursorProps} content={<ChartTooltipContent unit=" °C" />} />
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
