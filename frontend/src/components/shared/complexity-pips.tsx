import { cn } from "@/lib/utils";
import { complexityLabel, complexityLevel } from "@/lib/status";
import type { TaskComplexity } from "@/lib/types";

export function ComplexityPips({ complexity, className }: { complexity: TaskComplexity; className?: string }) {
  const level = complexityLevel[complexity];
  return (
    <span
      className={cn("inline-flex items-center gap-0.5", className)}
      title={`${complexityLabel[complexity]} complexity`}
      aria-label={`${complexityLabel[complexity]} complexity`}
    >
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn("size-1.5 rounded-full", i <= level ? "bg-foreground-secondary" : "bg-raised")} />
      ))}
    </span>
  );
}
