"use client";

import { useMemo } from "react";
import { Clapperboard } from "lucide-react";
import { SiteMap } from "@/features/map/site-map";
import type { LiveMachine } from "@/lib/api/client";
import type { LatLng, Machine, Zone } from "@/lib/types";
import type { Bar } from "./replay";

const RAMP = 0.15; // share of a portion spent travelling out, and back
const SPREAD_DEG = 0.0017; // ~190 m: ring radius for machines sharing a zone

function centroid(poly: LatLng[]): LatLng {
  const n = poly.length || 1;
  return {
    lat: poly.reduce((s, p) => s + p.lat, 0) / n,
    lng: poly.reduce((s, p) => s + p.lng, 0) / n,
  };
}

const lerp = (a: LatLng, b: LatLng, k: number): LatLng => ({
  lat: a.lat + (b.lat - a.lat) * k,
  lng: a.lng + (b.lng - a.lng) * k,
});

/** Compass bearing from a to b, degrees clockwise from north (flat-earth is fine at site scale). */
const bearing = (a: LatLng, b: LatLng) =>
  ((Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI + 360) % 360;

interface ReplayMapProps {
  portions: Bar[];
  t: number;
  zones: Zone[];
  zoneAssignments: { machine_id: string; zone_id: string }[];
  live: LiveMachine[];
}

/**
 * Schedule-derived positions, never live GPS. Each machine the plan uses is
 * parked at its last reported fix; while one of its portions runs, it moves
 * toward the centre of the work zone it is geofenced to
 * (machine_zone_assignments) and back as the portion ends. The badge stays on
 * screen so these positions can't be mistaken for the /map live feed.
 */
export function ReplayMap({ portions, t, zones, zoneAssignments, live }: ReplayMapProps) {
  const layout = useMemo(() => {
    const workZone = new Map(zones.filter((z) => z.kind === "work" && z.id !== "Z-PERIMETER").map((z) => [z.id, z]));
    const zoneOf = new Map<string, string>();
    for (const a of zoneAssignments) {
      if (workZone.has(a.zone_id) && !zoneOf.has(a.machine_id)) zoneOf.set(a.machine_id, a.zone_id);
    }
    const home = new Map(live.map((m) => [m.machine_id, { lat: m.lat, lng: m.lng }]));
    const byMachine = new Map<string, Bar[]>();
    for (const p of portions) byMachine.set(p.machine_id, [...(byMachine.get(p.machine_id) ?? []), p]);
    // Machines heading to the same zone get their own spot on a small ring
    // around its centre, so they don't stack into one marker.
    const sharing = new Map<string, string[]>();
    for (const id of byMachine.keys()) {
      const z = zoneOf.get(id);
      if (z) sharing.set(z, [...(sharing.get(z) ?? []), id]);
    }
    const dest = new Map<string, LatLng>();
    for (const [z, ids] of sharing) {
      const c = centroid(workZone.get(z)!.polygon);
      ids.forEach((id, i) => {
        if (ids.length === 1) return dest.set(id, c);
        const a = (2 * Math.PI * i) / ids.length;
        dest.set(id, { lat: c.lat + Math.cos(a) * SPREAD_DEG, lng: c.lng + Math.sin(a) * SPREAD_DEG * 1.3 });
      });
    }
    return { dest, home, byMachine };
  }, [portions, zones, zoneAssignments, live]);

  const machines: Machine[] = [];
  for (const [id, list] of layout.byMachine) {
    const base = layout.home.get(id) ?? layout.dest.get(id);
    if (!base) continue;
    const target = layout.dest.get(id) ?? base;
    const running = list.find((p) => p.start_min <= t && t < p.end_min);
    let position = base;
    let velocity = 0;
    let heading = 0;
    if (running) {
      const f = (t - running.start_min) / Math.max(1, running.end_min - running.start_min);
      const k = Math.min(1, f / RAMP, (1 - f) / RAMP);
      position = lerp(base, target, k);
      if (k < 1) {
        velocity = 1;
        heading = f < 0.5 ? bearing(base, target) : bearing(target, base);
      }
    }
    machines.push({
      id,
      model: `${list[0].machine_type} ${id}`,
      type: list[0].machine_type,
      status: running ? "operating" : "idle",
      operatorId: running?.worker_id ?? null,
      taskId: running ? String(running.id) : null,
      velocityKph: velocity,
      engineTempC: 0,
      position,
      heading,
      lastSeen: "",
    });
  }

  return (
    <div className="relative h-full min-h-[300px]">
      <SiteMap machines={machines} operators={[]} zones={zones} alerts={[]} />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 rounded-sm border border-info/40 bg-overlay/90 px-2 py-1 text-caption">
        <Clapperboard className="size-3.5 text-info" aria-hidden />
        <span className="font-semibold">Replay</span>
        <span className="text-muted-foreground">· simulated positions, not live GPS</span>
      </div>
    </div>
  );
}
