import { OctagonAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fatigueLabel, fatigueTone, toneClasses } from "@/lib/status";

interface FatigueIndicatorProps {
  score: number;
  showLabel?: boolean;
  className?: string;
}

/**
 * 5-segment bar + number — spec §5.3.1. Segments beat gauges in tables:
 * compact and comparable down a column.
 */
export function FatigueIndicator({ score, showLabel, className }: FatigueIndicatorProps) {
  const tone = fatigueTone(score);
  const filled = Math.max(score > 0 ? 1 : 0, Math.ceil(score / 20));

  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      aria-label={`Fatigue ${score} of 100, ${fatigueLabel(score)}`}
    >
      <span className="flex gap-0.5" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn("h-3 w-1.5 rounded-[1px]", i < filled ? toneClasses[tone].solid : "bg-raised")} />
        ))}
      </span>
      <span className={cn("w-6 font-mono text-small tabular-nums", tone === "success" ? "text-foreground" : toneClasses[tone].text)}>
        {score}
      </span>
      {tone === "danger" ? <OctagonAlert className="size-3.5 text-danger" aria-hidden /> : null}
      {showLabel ? <span className="text-caption text-muted-foreground">{fatigueLabel(score)}</span> : null}
    </span>
  );
}
