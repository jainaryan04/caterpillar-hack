"use client";

import Link from "next/link";
import { ArrowRight, MapPin, Siren } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/shared/relative-time";
import { useAcknowledgeAlert, useAlerts, useLookup } from "@/hooks/use-fleet-data";

/**
 * Global SOS banner — spec §16. Always visible while any emergency is
 * unacknowledged; shrinks to a "responding" strip once acknowledged.
 */
export function SosBanner() {
  const { data: alerts } = useAlerts();
  const lookup = useLookup();
  const acknowledgeAlert = useAcknowledgeAlert();

  const emergencies = (alerts ?? []).filter((a) => a.category === "emergency");
  const open = emergencies
    .filter((a) => a.status === "open")
    .sort((a, b) => a.raisedAt.localeCompare(b.raisedAt));
  const responding = emergencies.filter((a) => a.status === "acknowledged" || a.status === "responding");

  if (open.length > 0) {
    const first = open[0];
    const operator = lookup.operator(first.operatorId);
    const zone = lookup.zone(first.zoneId);

    return (
      <div role="alert" className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 bg-danger px-4 py-1.5 text-white">
        <span className="relative flex size-5 items-center justify-center">
          <span className="absolute inset-0 animate-sos-pulse rounded-full bg-white/40" />
          <Siren className="relative size-4" aria-hidden />
        </span>
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-small">
          <span className="font-semibold tracking-wide">SOS</span>
          <span className="truncate font-medium">{first.title}</span>
          <span className="hidden text-white/85 sm:inline">
            · {operator?.name ?? "Unknown"} · {zone?.name}
          </span>
          <span className="font-mono text-white/85">
            · <RelativeTime iso={first.raisedAt} mode="elapsed" /> elapsed
          </span>
          {open.length > 1 ? (
            <Link href="/safety" className="font-medium underline underline-offset-2">
              +{open.length - 1} more active
            </Link>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 bg-white font-semibold text-danger hover:bg-white/90"
            onClick={() =>
              acknowledgeAlert.mutate(
                { id: first.id },
                { onSuccess: () => toast.success(`${first.id} acknowledged`, { description: first.title }) },
              )
            }
          >
            Acknowledge
          </Button>
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 text-white hover:bg-white/15 hover:text-white"
          >
            <Link href={`/map?focus=${first.id}`}>
              <MapPin /> <span className="hidden sm:inline">View on map</span>
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (responding.length > 0) {
    return (
      <div role="status" className="flex h-8 shrink-0 items-center gap-2 bg-danger/80 px-4 text-small text-white">
        <Siren className="size-4" aria-hidden />
        <span className="flex-1 truncate">
          {responding.length} {responding.length === 1 ? "emergency" : "emergencies"} being responded to
        </span>
        <Link href="/safety" className="flex items-center gap-1 font-medium hover:underline">
          View <ArrowRight className="size-3.5" />
        </Link>
      </div>
    );
  }

  return null;
}
