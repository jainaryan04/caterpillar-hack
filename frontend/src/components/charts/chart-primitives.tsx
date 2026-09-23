"use client";

import { cn } from "@/lib/utils";

/**
 * Shared Recharts styling — spec §9.5. Gridlines are faint, axis labels are
 * 12px muted, reference lines dashed. Colors come from CSS variables so light
 * and dark themes both work.
 */

export const CHART = {
  grid: "var(--chart-grid)",
  axis: "var(--muted-foreground)",
  reference: "var(--foreground-secondary)",
  series: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"],
  status: {
    success: "var(--success)",
    warning: "var(--warning)",
    danger: "var(--danger)",
    info: "var(--info)",
    neutral: "var(--neutral)",
  },
  brand: "var(--brand)",
} as const;

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.axis, fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: CHART.grid,
  vertical: false,
} as const;

export const cursorProps = { stroke: "var(--border-strong)", strokeWidth: 1 } as const;
export const barCursorProps = { fill: "var(--raised)" } as const;

interface TooltipRow {
  name?: string | number;
  value?: number | string | readonly (number | string)[];
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: readonly TooltipRow[];
  label?: string | number;
  unit?: string;
  labelFormatter?: (label: string | number) => string;
  className?: string;
}

/** Tooltip body shared by every chart. Pass as `content={<ChartTooltipContent unit="%" />}`. */
export function ChartTooltipContent({ active, payload, label, unit, labelFormatter, className }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className={cn("min-w-36 rounded-md border bg-overlay px-3 py-2 text-caption shadow-lg", className)}>
      {label !== undefined ? (
        <div className="mb-1.5 font-medium text-foreground">{labelFormatter ? labelFormatter(label) : label}</div>
      ) : null}
      <ul className="flex flex-col gap-1">
        {payload.map((row, i) => (
          <li key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-foreground-secondary">
              <svg className="size-2.5" viewBox="0 0 10 10" aria-hidden>
                <rect width="10" height="10" rx="2" fill={row.color} />
              </svg>
              {row.name}
            </span>
            <span className="font-mono text-foreground tabular-nums">
              {Array.isArray(row.value) ? row.value.join("–") : row.value}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inline legend — HTML so it wraps and stays accessible. */
export function ChartLegend({
  items,
  className,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-foreground-secondary", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <svg className="h-2.5 w-4" viewBox="0 0 16 10" aria-hidden>
            {it.dashed ? (
              <line x1="0" y1="5" x2="16" y2="5" stroke={it.color} strokeWidth="2" strokeDasharray="3 2" />
            ) : (
              <rect y="1" width="16" height="8" rx="2" fill={it.color} />
            )}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
