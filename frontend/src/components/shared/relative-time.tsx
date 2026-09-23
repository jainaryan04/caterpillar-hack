"use client";

import { useNow } from "@/hooks/use-now";
import { formatElapsed, formatRelative, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RelativeTimeProps {
  iso: string;
  /** "relative" → "4m ago"; "elapsed" → ticking "04:12" timer */
  mode?: "relative" | "elapsed";
  className?: string;
}

/** SSR renders the absolute time; the client swaps in a live relative value. */
export function RelativeTime({ iso, mode = "relative", className }: RelativeTimeProps) {
  const now = useNow(mode === "elapsed" ? 1000 : 30_000);
  const text = now === null ? formatTime(iso) : mode === "elapsed" ? formatElapsed(iso, now) : formatRelative(iso, now);
  return (
    <time dateTime={iso} title={formatTime(iso)} className={cn("tabular-nums", className)}>
      {text}
    </time>
  );
}
