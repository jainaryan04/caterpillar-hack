"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/status";

export interface SummaryItem {
  key: string;
  label: string;
  value: number | string;
  tone?: Tone;
  icon?: LucideIcon;
}

interface SummaryStripProps {
  items: SummaryItem[];
  /** Clicking a tile toggles it as a filter */
  active?: string | null;
  onSelect?: (key: string | null) => void;
  className?: string;
}

/** Count tiles above a list; each one is a filter shortcut — spec §5.3 / §5.4. */
export function SummaryStrip({ items, active, onSelect, className }: SummaryStripProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap", className)}>
      {items.map((it) => {
        const isActive = active === it.key;
        const Icon = it.icon;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onSelect?.(isActive ? null : it.key)}
            aria-pressed={isActive}
            className={cn(
              "flex min-w-36 flex-1 flex-col gap-0.5 rounded-lg border bg-panel px-4 py-3 text-left transition-colors hover:border-border-strong",
              isActive && "border-foreground-secondary bg-raised",
            )}
          >
            <span className="eyebrow flex items-center gap-1.5">
              {Icon ? <Icon className={cn("size-3.5", it.tone && toneClasses[it.tone].text)} aria-hidden /> : null}
              {it.label}
            </span>
            <span
              className={cn(
                "text-h2 tabular-nums",
                it.tone && it.tone !== "neutral" && it.tone !== "success" && Number(it.value) > 0
                  ? toneClasses[it.tone].text
                  : "text-foreground",
              )}
            >
              {it.value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
