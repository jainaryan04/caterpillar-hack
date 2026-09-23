import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  /** Color comes from `text-*` classes via currentColor */
  className?: string;
}

/** 12-point trend line for KPI tiles. Pure SVG, no chart library. */
export function Sparkline({ data, className }: SparklineProps) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => `${((i / (data.length - 1)) * 100).toFixed(2)},${(22 - ((v - min) / range) * 20).toFixed(2)}`)
    .join(" ");

  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn("h-5 w-20 overflow-visible text-muted-foreground", className)}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
