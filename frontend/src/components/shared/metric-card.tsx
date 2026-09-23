import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneClasses, toneIcon, type Tone } from "@/lib/status";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  /** Threshold state; adds color + icon together (never color alone) */
  tone?: Tone | null;
  icon?: LucideIcon;
  sub?: ReactNode;
  /** Live value older than the freshness window — dims and shows ⏱ */
  stale?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Compact metric / telemetry cell. Used for machine telemetry, analytics stats
 * and summary strips. Owns threshold + stale styling so pages can't drift.
 */
export function MetricCard({
  label,
  value,
  unit,
  tone,
  icon: Icon,
  sub,
  stale,
  size = "md",
  className,
}: MetricCardProps) {
  const ThresholdIcon = tone && tone !== "success" && tone !== "neutral" ? toneIcon[tone] : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border bg-panel", size === "md" ? "p-4" : "p-3", className)}>
      <span className="eyebrow flex items-center gap-1.5 truncate">
        {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
        {label}
      </span>
      <span
        className={cn(
          "flex items-baseline gap-1 font-mono tabular-nums",
          size === "md" ? "text-h2" : "text-h3",
          stale ? "text-muted-foreground" : tone ? toneClasses[tone].text : "text-foreground",
        )}
      >
        {ThresholdIcon && !stale ? <ThresholdIcon className="size-4 self-center" aria-hidden /> : null}
        {stale ? <Timer className="size-4 self-center" aria-label="Stale value" /> : null}
        {value}
        {unit ? <span className="font-sans text-small text-foreground-secondary">{unit}</span> : null}
      </span>
      {sub ? <span className="truncate text-caption text-muted-foreground">{sub}</span> : null}
    </div>
  );
}
