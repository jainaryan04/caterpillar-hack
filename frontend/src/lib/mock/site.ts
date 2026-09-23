import type { LatLng, Zone } from "@/lib/types";

/** Geographic bounds of the demo site (fictional quarry in northern Nevada). */
export const SITE_BOUNDS = {
  north: 40.842,
  south: 40.818,
  west: -115.79,
  east: -115.75,
};

/** Site-plan canvas the map placeholder renders into. */
export const SITE_PLAN = { width: 1000, height: 640 };

/** Convert a site-plan coordinate to lat/lng, so mock data carries real coordinates. */
export function pt(x: number, y: number): LatLng {
  const { north, south, west, east } = SITE_BOUNDS;
  return {
    lat: +(north - (y / SITE_PLAN.height) * (north - south)).toFixed(6),
    lng: +(west + (x / SITE_PLAN.width) * (east - west)).toFixed(6),
  };
}

export const zones: Zone[] = [
  {
    id: "Z-B4",
    name: "Bench 4",
    kind: "work",
    polygon: [pt(120, 110), pt(380, 90), pt(420, 240), pt(150, 270)],
  },
  {
    id: "Z-B5",
    name: "Bench 5",
    kind: "work",
    polygon: [pt(450, 95), pt(660, 80), pt(690, 230), pt(470, 250)],
  },
  {
    id: "Z-HR2",
    name: "Haul Road 2",
    kind: "work",
    polygon: [pt(380, 285), pt(740, 330), pt(740, 372), pt(380, 327)],
  },
  {
    id: "Z-CR",
    name: "Crusher Pad",
    kind: "work",
    polygon: [pt(760, 280), pt(920, 272), pt(930, 420), pt(770, 432)],
  },
  {
    id: "Z-WD",
    name: "Waste Dump North",
    kind: "work",
    polygon: [pt(90, 360), pt(330, 345), pt(350, 560), pt(110, 585)],
  },
  {
    id: "Z-WS",
    name: "Workshop & Fuel Bay",
    kind: "work",
    polygon: [pt(760, 478), pt(905, 470), pt(912, 612), pt(770, 618)],
  },
  {
    id: "Z-BLAST",
    name: "Blast Zone B7",
    kind: "restricted",
    polygon: [pt(575, 122), pt(655, 116), pt(662, 184), pt(582, 190)],
    activeWindow: "12:30–13:30",
    rule: "No entry during blast window. Clearance by shot-firer only.",
  },
  {
    id: "Z-HW",
    name: "High-wall Exclusion",
    kind: "restricted",
    polygon: [pt(80, 40), pt(430, 22), pt(436, 62), pt(92, 84)],
    rule: "Permanent exclusion — unstable high-wall.",
  },
  {
    id: "Z-FUEL",
    name: "Fuel Farm",
    kind: "restricted",
    polygon: [pt(925, 470), pt(980, 466), pt(983, 524), pt(928, 528)],
    rule: "Authorised fuel personnel only. No ignition sources.",
  },
];

export const zoneById = (id: string) => zones.find((z) => z.id === id);
