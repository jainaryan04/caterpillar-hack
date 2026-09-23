import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { Shift } from "@/lib/types";

interface ShiftProgressProps {
  shift: Shift | null;
  hoursWorked: number;
  plannedHours: number;
  compact?: boolean;
  className?: string;
}

/** Shift name + window + progress through planned hours. */
export function ShiftProgress({ shift, hoursWorked, plannedHours, compact, className }: ShiftProgressProps) {
  if (!shift) return <span className="text-small text-muted-foreground">No shift</span>;

  const pct = plannedHours > 0 ? Math.min(100, (hoursWorked / plannedHours) * 100) : 0;
  const nearLimit = pct >= 80;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", compact ? "w-32" : "w-full", className)}>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="truncate text-foreground">
          {shift.name} <span className="text-muted-foreground tabular-nums">{shift.start}–{shift.end}</span>
        </span>
        {!compact ? (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {hoursWorked.toFixed(1)} / {plannedHours} h
          </span>
        ) : null}
      </div>
      <Progress
        value={pct}
        aria-label={`${hoursWorked.toFixed(1)} of ${plannedHours} hours worked`}
        className={cn("h-1 bg-raised", nearLimit ? "[&>div]:bg-warning" : "[&>div]:bg-foreground-secondary")}
      />
    </div>
  );
}
