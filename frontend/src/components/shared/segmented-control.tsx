"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  ariaLabel: string;
  className?: string;
  /** Hide text labels below sm, keep icons */
  iconOnlyOnMobile?: boolean;
}

/** View switcher (Day | Week | Month, Table | Grid). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  iconOnlyOnMobile,
}: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={ariaLabel}
      spacing={0}
      className={cn("h-9 rounded-md border bg-inset p-0.5", className)}
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <ToggleGroupItem
          key={v}
          value={v}
          aria-label={label}
          className="h-full rounded-[3px]! px-2.5 text-small text-foreground-secondary hover:bg-transparent hover:text-foreground data-[state=on]:bg-raised data-[state=on]:text-foreground"
        >
          {Icon ? <Icon className="size-4" /> : null}
          <span className={cn(Icon && iconOnlyOnMobile && "sr-only sm:not-sr-only")}>{label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
