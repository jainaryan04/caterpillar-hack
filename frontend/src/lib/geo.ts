import type { LatLng, Zone } from "@/lib/types";

/**
 * Same even-odd ray-casting test as `point_in_polygon()` in
 * Prediction/db/schema.sql, kept algorithmically identical on purpose so the
 * UI's idea of "which zone is this machine in" can never silently diverge
 * from what the backend's own geofence alerts are based on.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const { lat: yi, lng: xi } = polygon[i];
    const { lat: yj, lng: xj } = polygon[j];
    if (yi > point.lat !== yj > point.lat) {
      if (point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** The first zone (of possibly several) containing `point`. A machine can
 * genuinely be assigned to and inside more than one at once (e.g. a haul
 * truck's road/crusher/dump zones overlap at their edges); this is a
 * single-zone display convenience, not the whole picture. */
export function zoneContaining(point: LatLng, zones: Zone[]): Zone | undefined {
  return zones.find((z) => pointInPolygon(point, z.polygon));
}
