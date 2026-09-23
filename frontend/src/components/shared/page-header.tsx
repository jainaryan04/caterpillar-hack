import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** Secondary line: site, shift, counts */
  description?: ReactNode;
  /** Right-aligned page actions; at most one primary (yellow) button */
  actions?: ReactNode;
  /** Optional toolbar row below the title (filters, view switchers) */
  toolbar?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, toolbar, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pb-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-h1 text-foreground">{title}</h1>
          {description ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-foreground-secondary">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
    </header>
  );
}

/** Dot separator for PageHeader descriptions. */
export function MetaDot() {
  return <span aria-hidden className="text-disabled-foreground">·</span>;
}
