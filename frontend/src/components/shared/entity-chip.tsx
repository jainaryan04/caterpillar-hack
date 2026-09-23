import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Machine, Operator } from "@/lib/types";
import { MachineIcon } from "./machine-icon";

/** Avatar + name + mono ID — the first-column pattern for tables (spec §11). */
export function OperatorChip({
  operator,
  size = "md",
  className,
}: {
  operator: Pick<Operator, "id" | "name" | "initials">;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Avatar className={size === "sm" ? "size-6" : "size-8"}>
        <AvatarFallback className="bg-raised text-caption font-semibold text-foreground-secondary">
          {operator.initials}
        </AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium text-foreground">{operator.name}</span>
        {size === "md" ? <span className="font-mono text-caption text-muted-foreground">{operator.id}</span> : null}
      </span>
    </span>
  );
}

export function MachineChip({
  machine,
  size = "md",
  className,
}: {
  machine: Pick<Machine, "id" | "model" | "type">;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md border bg-raised text-foreground-secondary",
          size === "sm" ? "size-6" : "size-8",
        )}
      >
        <MachineIcon type={machine.type} width={size === "sm" ? 14 : 18} height={size === "sm" ? 14 : 18} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-mono font-medium text-foreground">{machine.id}</span>
        {size === "md" ? <span className="truncate text-caption text-muted-foreground">{machine.model}</span> : null}
      </span>
    </span>
  );
}
