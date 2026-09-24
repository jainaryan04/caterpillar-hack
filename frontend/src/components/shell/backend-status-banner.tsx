"use client";

import { CircleAlert, WifiOff } from "lucide-react";
import { useApiHealth } from "@/hooks/use-fleet-data";

/**
 * Unmissable, app-wide reason for "why is everything empty/loading". Every
 * live-data screen already fails silently into a skeleton or an empty list
 * when the backend can't be reached (see use-fleet-data.ts) -- that alone
 * looks indistinguishable from "there is just nothing to show" or a hung
 * page. This is the one place that says which of those it actually is.
 */
export function BackendStatusBanner() {
  const { data, isError } = useApiHealth();

  if (isError) {
    return (
      <div role="alert" className="flex h-9 shrink-0 items-center gap-2 bg-danger px-4 text-small text-white">
        <WifiOff className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          No response from the API within 4s — either <code className="font-mono">uvicorn</code> is not running, or
          it is stuck waiting on an unreachable database. Retrying every 5s.
        </span>
      </div>
    );
  }

  if (data && data.database !== "connected") {
    return (
      <div role="alert" className="flex h-9 shrink-0 items-center gap-2 bg-warning px-4 text-small text-foreground">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        <span className="truncate">
          Backend is up but the database is {data.database === "not-configured" ? "not configured" : "unreachable"} —
          scheduling still works, but machines, tasks, zones and alerts cannot load. Retrying every 5s.
        </span>
      </div>
    );
  }

  return null;
}
