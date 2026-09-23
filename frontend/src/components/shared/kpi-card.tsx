import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CircleCheck, Info, Minus, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkline } from "./sparkline";

export type KpiTone = "default" | "brand" | "success" | "warning" | "danger";

export interface KpiDelta {
  text: string;
  direction: "up" | "down" | "flat";
  /** Color follows good/bad, not up/down — spec §15 */
  good: boolean;
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  denominator?: ReactNode;
  unit?: string;
  tone?: KpiTone;
  delta?: KpiDelta;
  /** Replaces the delta line, e.g. "All clear" */
  caption?: ReactNode;
  sparkline?: number[];
  href?: string;
  info?: string;
  /** Pulsing dot for unacknowledged critical events */
  pulse?: boolean;
  className?: string;
}

const valueTone: Record<KpiTone, string> = {
  default: "text-foreground",
  brand: "text-brand-text",
  success: "text-foreground",
  warning: "text-warning",
  danger: "text-danger",
};

const railTone: Partial<Record<KpiTone, string>> = {
  warning: "before:bg-warning",
  danger: "before:bg-danger",
};

const sparkTone: Record<KpiTone, string> = {
  default: "text-muted-foreground",
  brand: "text-brand-text/70",
  success: "text-success/70",
  warning: "text-warning/80",
  danger: "text-danger/80",
};

const toneIcon = { warning: TriangleAlert, danger: OctagonAlert, success: CircleCheck } as const;

/** Dashboard KPI tile — spec §15. The whole tile is a link to the filtered list. */
export function KpiCard({
  label,
  value,
  denominator,
  unit,
  tone = "default",
  delta,
  caption,
  sparkline,
  href,
  info,
  pulse,
  className,
}: KpiCardProps) {
  const StatusIcon = tone === "warning" || tone === "danger" || tone === "success" ? toneIcon[tone] : null;
  const DeltaIcon = delta?.direction === "up" ? ArrowUpRight : delta?.direction === "down" ? ArrowDownRight : Minus;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow truncate">{label}</span>
        {info ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-muted-foreground hover:text-foreground" aria-label={`About ${label}`}>
                <Info className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-60">{info}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          {StatusIcon ? (
            <StatusIcon
              className={cn("size-5 shrink-0 self-center", tone === "success" ? "text-success" : valueTone[tone])}
              aria-hidden
            />
          ) : null}
          <span className={cn("text-kpi tabular-nums", valueTone[tone])}>{value}</span>
          {unit ? <span className="text-body text-foreground-secondary">{unit}</span> : null}
          {denominator !== undefined ? (
            <span className="text-h3 font-normal whitespace-nowrap text-foreground-secondary tabular-nums">/ {denominator}</span>
          ) : null}
          {pulse ? (
            <span className="relative ml-1 flex size-2.5 shrink-0 self-center" aria-label="Unacknowledged">
              <span className="absolute inset-0 animate-sos-pulse rounded-full bg-danger" />
              <span className="relative size-2.5 rounded-full bg-danger" />
            </span>
          ) : null}
        </div>
        {sparkline ? <Sparkline data={sparkline} className={cn("mb-1.5 w-14 shrink-0 2xl:w-20", sparkTone[tone])} /> : null}
      </div>

      <div className="min-h-4">
        {caption ? (
          <span className="block truncate text-caption text-foreground-secondary">{caption}</span>
        ) : delta ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-caption",
              delta.direction === "flat" ? "text-muted-foreground" : delta.good ? "text-success" : "text-danger",
            )}
          >
            <DeltaIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{delta.text}</span>
          </span>
        ) : null}
      </div>
    </>
  );

  const classes = cn(
    "relative flex min-h-28 min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border bg-panel p-4",
    "before:absolute before:inset-x-0 before:top-0 before:h-0.5",
    railTone[tone],
    href && "transition-colors hover:border-border-strong",
    className,
  );

  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
