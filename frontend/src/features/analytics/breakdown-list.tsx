import { cn } from "@/lib/utils";

interface BreakdownListProps {
  items: { label: string; value: number; display?: string }[];
  /** Max for the bar scale; defaults to the largest value */
  max?: number;
  /** Highlight values under this threshold (e.g. under-utilised types) */
  warnBelow?: number;
  className?: string;
}

/** Ranked horizontal bars — spec §5.8 "Breakdown" column. SVG bars, no inline styles. */
export function BreakdownList({ items, max, warnBelow, className }: BreakdownListProps) {
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((it) => {
        const low = warnBelow !== undefined && it.value < warnBelow;
        return (
          <li key={it.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-small">
              <span className="truncate text-foreground-secondary">{it.label}</span>
              <span className={cn("font-mono tabular-nums", low && "text-warning")}>{it.display ?? it.value}</span>
            </div>
            <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
              <rect width="100" height="4" className="fill-raised" />
              <rect width={(it.value / top) * 100} height="4" className={low ? "fill-warning" : "fill-chart-1"} />
            </svg>
          </li>
        );
      })}
    </ul>
  );
}
