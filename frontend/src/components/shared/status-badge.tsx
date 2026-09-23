import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneClasses, toneIcon, type StatusMeta, type Tone } from "@/lib/status";

type StatusBadgeProps = {
  className?: string;
  size?: "sm" | "md";
  /** Solid-dot style without a background, for dense table cells */
  variant?: "subtle" | "plain";
} & ({ meta: StatusMeta } | { tone: Tone; label: string; icon?: LucideIcon });

/** Status = icon + label + color, always together — spec §0.2, §9.3. */
export function StatusBadge(props: StatusBadgeProps) {
  const { className, size = "md", variant = "subtle" } = props;
  const { tone, label, icon } =
    "meta" in props ? props.meta : { tone: props.tone, label: props.label, icon: props.icon };
  const Icon = icon ?? toneIcon[tone];
  const t = toneClasses[tone];

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-sm font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-caption" : "h-6 px-2 text-small",
        variant === "subtle" ? cn("border", t.bg, t.border) : "px-0",
        t.text,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      <span className={variant === "subtle" && tone !== "neutral" ? "text-foreground" : undefined}>{label}</span>
    </span>
  );
}
