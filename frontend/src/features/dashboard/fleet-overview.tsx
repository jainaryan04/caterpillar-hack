"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { Skeleton } from "@/components/ui/skeleton";
import { SiteMap } from "@/features/map/site-map";
import { MapLegend } from "@/features/map/map-legend";
import type { Machine, Operator, SafetyAlert, Zone } from "@/lib/types";

interface FleetOverviewProps {
  machines?: Machine[];
  operators?: Operator[];
  zones?: Zone[];
  alerts?: SafetyAlert[];
}

/** Mini map — spec §5.1. No controls; click through to the Live Map. */
export function FleetOverview({ machines, operators, zones, alerts }: FleetOverviewProps) {
  const ready = machines && operators && zones && alerts;
  return (
    <SectionCard
      title="Fleet overview"
      subtitle="Pit 3 North · schematic"
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href="/map">
            Open map <ArrowRight />
          </Link>
        </Button>
      }
      bodyClassName="p-0 flex flex-col"
      className="h-full"
    >
      <Link
        href="/map"
        className="relative block aspect-[1000/640] min-h-56 flex-1 overflow-hidden bg-(--map-land)"
        aria-label="Open live map"
      >
        {ready ? (
          <SiteMap machines={machines} operators={operators} zones={zones} alerts={alerts} compact />
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}
      </Link>
      <MapLegend compact className="border-t px-4 py-2.5" />
    </SectionCard>
  );
}
