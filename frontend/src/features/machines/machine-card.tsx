import { cn } from "@/lib/utils";
import { MachineIcon } from "@/components/shared/machine-icon";
import { RelativeTime } from "@/components/shared/relative-time";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDuration } from "@/lib/format";
import { ENGINE_TEMP } from "@/lib/thresholds";
import { engineTempTone, machineStatusMeta, toneClasses, toneIcon } from "@/lib/status";
import type { Machine, Operator, Task } from "@/lib/types";

interface MachineCardProps {
  machine: Machine;
  operator?: Operator;
  task?: Task;
  selected?: boolean;
  onSelect: (id: string) => void;
}

/**
 * Fleet grid card — spec §10. A colored top rail appears only for fault or a
 * critical threshold, so a normal fleet reads calm.
 */
export function MachineCard({ machine: m, operator, task, selected, onSelect }: MachineCardProps) {
  const tempTone = engineTempTone(m.engineTempC, ENGINE_TEMP);
  const TempIcon = tempTone ? toneIcon[tempTone] : null;
  const alarm = m.status === "fault" || tempTone === "danger";
  const stale = m.status === "offline";

  return (
    <button
      type="button"
      onClick={() => onSelect(m.id)}
      aria-pressed={selected}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-lg border bg-panel text-left transition-colors hover:border-border-strong",
        alarm && "before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-danger",
        selected && "border-brand bg-brand/5",
      )}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-3">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-raised text-foreground-secondary">
            <MachineIcon type={m.type} width={20} height={20} />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="font-mono font-medium">{m.id}</span>
            <span className="truncate text-caption text-muted-foreground">{m.model}</span>
          </span>
        </span>
        <StatusBadge meta={machineStatusMeta[m.status]} size="sm" />
      </div>

      <dl className={cn("grid grid-cols-3 border-y", stale && "text-muted-foreground")}>
        <div className="flex flex-col gap-0.5 px-4 py-2.5">
          <dt className="eyebrow">Velocity</dt>
          <dd className="font-mono text-small tabular-nums">
            {m.velocityKph.toFixed(1)} <span className="font-sans text-caption text-muted-foreground">km/h</span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 border-x px-4 py-2.5">
          <dt className="eyebrow">Engine</dt>
          <dd className={cn("flex items-center gap-1 font-mono text-small tabular-nums", !stale && tempTone && toneClasses[tempTone].text)}>
            {TempIcon && !stale ? <TempIcon className="size-3.5" aria-hidden /> : null}
            {m.engineTempC} <span className="font-sans text-caption text-muted-foreground">°C</span>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5 px-4 py-2.5">
          <dt className="eyebrow">Runtime</dt>
          <dd className="font-mono text-small tabular-nums">
            {m.runtimeTodayMin != null ? formatDuration(m.runtimeTodayMin) : "—"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-0.5 px-4 py-3 text-caption">
        <span className="truncate text-foreground-secondary">
          {operator ? operator.id : <span className="text-muted-foreground">No operator</span>}
          {task ? <span className="text-muted-foreground"> · {task.id} {task.title}</span> : null}
        </span>
        <span className="text-muted-foreground">
          Updated <RelativeTime iso={m.lastSeen} />
        </span>
      </div>
    </button>
  );
}
