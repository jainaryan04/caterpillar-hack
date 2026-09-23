"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { alertCategoryLabel, alertStatusMeta, severityMeta, toneClasses } from "@/lib/status";
import type { EntityLookup } from "@/hooks/use-fleet-data";
import type { SafetyAlert } from "@/lib/types";

interface EventRowProps {
  alert: SafetyAlert;
  lookup: EntityLookup;
  selected: boolean;
  onSelect: (id: string) => void;
  onAcknowledge: (a: SafetyAlert) => void;
}

/**
 * Event queue row — spec §5.7 / §10. The 4px severity rail is the one allowed
 * color rail: severity must read at a glance.
 */
export function EventRow({ alert: a, lookup, selected, onSelect, onAcknowledge }: EventRowProps) {
  const sev = severityMeta[a.severity];
  const SevIcon = sev.icon;
  const pulsing = a.severity === "critical" && a.status === "open";
  const subject = [lookup.operator(a.operatorId)?.name, a.machineId, lookup.zone(a.zoneId)?.name].filter(Boolean).join(" · ");

  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 border-l-4 bg-panel py-3 pr-3 pl-3 sm:flex-row sm:items-center",
        a.severity === "critical" || a.severity === "high" ? "border-l-danger" : a.severity === "medium" ? "border-l-warning" : "border-l-info",
        selected ? "bg-raised" : "hover:bg-raised/60",
        pulsing && "bg-danger/[0.06]",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(a.id)}
        className="flex min-w-0 flex-1 items-start gap-3 text-left after:absolute after:inset-0"
        aria-current={selected ? "true" : undefined}
      >
        <span className={cn("relative mt-0.5 flex size-5 shrink-0 items-center justify-center", toneClasses[sev.tone].text)}>
          {pulsing ? <span className="absolute inset-0 animate-sos-pulse rounded-full bg-danger/50" /> : null}
          <SevIcon className="relative size-4" aria-label={sev.label} />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-caption text-muted-foreground">
            <span className="eyebrow">{alertCategoryLabel[a.category]}</span>
            <span className="font-mono">{a.id}</span>
          </span>
          <span className="truncate text-body font-medium">{a.title}</span>
          <span className="truncate text-small text-foreground-secondary">{subject}</span>
        </span>
      </button>

      <div className="relative z-10 flex shrink-0 items-center gap-3 pl-8 sm:pl-0">
        <span className="flex flex-col items-end gap-1">
          <StatusBadge meta={alertStatusMeta[a.status]} size="sm" />
          <span className={cn("font-mono text-caption", a.status === "open" ? "text-danger" : "text-muted-foreground")}>
            <RelativeTime iso={a.raisedAt} mode={a.status === "open" ? "elapsed" : "relative"} />
          </span>
        </span>
        {a.status === "open" ? (
          <Button variant={a.category === "emergency" ? "critical" : "secondary"} size="sm" onClick={() => onAcknowledge(a)}>
            Acknowledge
          </Button>
        ) : null}
      </div>
    </li>
  );
}
