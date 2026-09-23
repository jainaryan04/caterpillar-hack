"use client";

import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const ALL = "all";

interface FilterSelectProps<T extends string> {
  label: string;
  value: T | typeof ALL;
  onChange: (value: T | typeof ALL) => void;
  options: { value: T; label: string }[];
  className?: string;
}

/** Compact filter dropdown with an "All" option. Active filters get a stronger border. */
export function FilterSelect<T extends string>({ label, value, onChange, options, className }: FilterSelectProps<T>) {
  const active = value !== ALL;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T | typeof ALL)}>
      <SelectTrigger
        size="sm"
        aria-label={label}
        className={cn("h-9 min-w-36 bg-inset text-small", active && "border-border-strong text-foreground", className)}
      >
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
