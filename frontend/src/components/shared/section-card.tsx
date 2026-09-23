import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

/** Generic panel container — spec §10: panel bg, 1px border, 6px radius, no shadow. */
export function SectionCard({
  title,
  subtitle,
  action,
  footer,
  children,
  className,
  bodyClassName,
}: SectionCardProps) {
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border bg-panel", className)}>
      {title || action ? (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            {title ? <h2 className="truncate text-h3">{title}</h2> : null}
            {subtitle ? <p className="truncate text-caption text-muted-foreground">{subtitle}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
      {footer ? <div className="border-t px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}
