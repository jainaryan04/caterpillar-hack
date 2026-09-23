"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RightDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Badges / status shown under the title */
  meta?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  size?: "md" | "lg";
  className?: string;
}

/** Quick-look side sheet — spec §3: detail without losing your place in the list. */
export function RightDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  meta,
  footer,
  children,
  size = "md",
  className,
}: RightDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full gap-0 border-l bg-panel p-0",
          size === "md" ? "sm:max-w-[480px]" : "sm:max-w-[640px]",
          className,
        )}
      >
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <SheetTitle className="text-h2">{title}</SheetTitle>
          {subtitle ? (
            <SheetDescription className="text-small text-foreground-secondary">{subtitle}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Details</SheetDescription>
          )}
          {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}

/** Labelled group inside a drawer body. */
export function DrawerSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2 py-3 first:pt-0", className)}>
      <h3 className="eyebrow">{title}</h3>
      {children}
    </section>
  );
}

/** Two-column key/value list for drawer details. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-small">
      {items.map((it) => (
        <div key={it.label} className="contents">
          <dt className="text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 text-foreground">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}
