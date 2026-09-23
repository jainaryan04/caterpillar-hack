import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ConnectionState = "live" | "reconnecting" | "offline" | "demo";

const states: Record<ConnectionState, { label: string; dot: string; hint: string }> = {
  live: { label: "Live", dot: "bg-success", hint: "Receiving live updates" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warning animate-pulse", hint: "Live updates paused, reconnecting" },
  offline: { label: "Offline", dot: "bg-danger", hint: "Live updates paused, showing last known data" },
  demo: { label: "Demo data", dot: "bg-info", hint: "Realtime is not connected yet; showing mock data" },
};

/**
 * Socket health indicator — spec §19. The prototype has no socket, so it
 * reports "demo" rather than pretending to be live.
 */
export function ConnectionStatus({
  state = "demo",
  collapsed,
  className,
}: {
  state?: ConnectionState;
  collapsed?: boolean;
  className?: string;
}) {
  const s = states[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("flex items-center gap-2 text-caption text-foreground-secondary", className)}
          role="status"
          aria-label={`Connection: ${s.label}`}
        >
          <span className={cn("size-2 shrink-0 rounded-full", s.dot)} />
          {!collapsed ? <span className="truncate">{s.label}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent side={collapsed ? "right" : "bottom"}>{s.hint}</TooltipContent>
    </Tooltip>
  );
}
