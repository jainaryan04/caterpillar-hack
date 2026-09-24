import type { LatLng } from "@/lib/types";

/** Geographic bounds of the site. Matches the `sites` row seeded in
 * Prediction/db/schema.sql exactly, so real machine/zone coordinates from the
 * API plot straight onto this plan with no conversion on either side. */
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
