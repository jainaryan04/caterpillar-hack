import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { alertStatusMeta, toneClasses } from "@/lib/status";
import type { AlertStatus, SafetyAlert } from "@/lib/types";

const STAGES: AlertStatus[] = ["open", "acknowledged", "responding", "resolved"];

/**
 * Response pipeline — spec §5.7 lifecycle: Open → Acknowledged → Responding →
 * Resolved, with Escalated as a side branch.
 */
export function ResolutionWorkflow({ alerts, onSelect }: { alerts: SafetyAlert[]; onSelect: (id: string) => void }) {
  const today = new Date().toDateString();
  const escalated = alerts.filter((a) => a.status === "escalated");

  return (
    <section className="rounded-lg border bg-panel" aria-label="Response pipeline">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-h3">Response pipeline</h2>
        {escalated.length ? (
          <span className="flex items-center gap-1.5 text-caption text-danger">
            <span className="size-1.5 rounded-full bg-danger" /> {escalated.length} escalated to manager
          </span>
        ) : null}
      </div>
      <ol className="grid grid-cols-2 lg:grid-cols-4">
        {STAGES.map((stage, i) => {
          const meta = alertStatusMeta[stage];
          const items = alerts.filter(
            (a) => a.status === stage && (stage !== "resolved" || new Date(a.raisedAt).toDateString() === today),
          );
          const Icon = meta.icon;
          return (
            <li key={stage} className={cn("relative flex flex-col gap-2 p-4", i > 0 && "border-l", i >= 2 && "max-lg:border-t", i === 2 && "max-lg:border-l-0")}>
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5">
                  <Icon className={cn("size-3.5", toneClasses[meta.tone].text)} aria-hidden />
                  {meta.label}
                  {stage === "resolved" ? " today" : ""}
                </span>
                {i < STAGES.length - 1 ? (
                  <ChevronRight className="hidden size-4 text-disabled-foreground lg:block" aria-hidden />
                ) : null}
              </div>
              <span className={cn("text-kpi tabular-nums", stage === "open" && items.length > 0 ? "text-danger" : "text-foreground")}>
                {items.length}
              </span>
              <ul className="flex flex-wrap gap-1">
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(a.id)}
                      className="rounded-sm border bg-raised px-1.5 py-0.5 font-mono text-caption text-foreground-secondary hover:border-border-strong hover:text-foreground"
                      title={a.title}
                    >
                      {a.id}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
