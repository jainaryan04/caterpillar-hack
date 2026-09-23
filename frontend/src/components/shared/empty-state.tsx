import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { CircleCheck, Inbox, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  /**
   * clear    — empty because nothing is wrong (green check)
   * filtered — empty because of filters (always offer Clear filters)
   * default  — nothing here yet
   * Spec §17: the first two must look different.
   */
  variant?: "clear" | "filtered" | "default";
  className?: string;
}

const variantIcon = { clear: CircleCheck, filtered: SearchX, default: Inbox } as const;

export function EmptyState({ title, description, action, icon, variant = "default", className }: EmptyStateProps) {
  const Icon = icon ?? variantIcon[variant];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <Icon
        className={cn("size-10 stroke-[1.25]", variant === "clear" ? "text-success" : "text-muted-foreground")}
        aria-hidden
      />
      <h3 className="text-h3">{title}</h3>
      {description ? <p className="max-w-sm text-small text-foreground-secondary">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
