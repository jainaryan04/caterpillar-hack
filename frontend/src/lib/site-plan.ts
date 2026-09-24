/**
 * Site geometry for the schematic map. SITE_BOUNDS matches the `sites` row
 * seeded in Prediction/db/schema.sql exactly, so real machine and zone
 * coordinates from the API plot straight onto this plan with no conversion
 * on either side.
 */

export const SITE_BOUNDS = {
  north: 40.842,
  south: 40.818,
  west: -115.79,
  east: -115.75,
};

/** Site-plan canvas the map renders into. */
export const SITE_PLAN = { width: 1000, height: 640 };
