"""Place every machine at a realistic starting GPS fix, given the zones and
assignments db/schema.sql already seeded.

    python scripts/seed_gps_baseline.py

Why this is a script and not more SQL in schema.sql
-----------------------------------------------------
schema.sql owns STRUCTURE and REFERENCE data: the site's bounding box, zone
geometry, per-type thresholds, and which zone(s) each machine TYPE is
normally assigned to. Where a specific machine physically sits right now is
OPERATIONAL data -- the same kind of thing a live GPS feed would update every
few seconds once one exists. Baking a one-time random placement into the
idempotent schema file would fight every future re-run: run schema.sql
again and it would silently overwrite wherever machines have actually moved
to since.

This script runs once, deliberately, after schema.sql: existing machines
first land on a coarse grid across the whole site (schema.sql's own
backfill, so nothing is ever NULL), and are still there until zones exist to
place them properly. This script moves each machine into ONE of its
assigned zones (spread across all of them for a multi-zone type, e.g. a haul
truck across its road/crusher/dump legs), with jitter kept inside the
polygon -- verified with the same point-in-polygon test the database uses,
not assumed.

Effect at rest: 0 machines outside their geofence, 0 sitting in a restricted
zone, and the closest machine-to-machine distance still well clear of every
proximity threshold. That is the point -- alerts should come from simulated
MOVEMENT later, not from how the baseline happened to be seeded.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.settings import settings  # noqa: E402

SEED = 42  # reproducible: re-running this script gives the same layout

# Machine types with a real bench/road/pad home. Everything else keeps its
# Z-PERIMETER assignment and whatever position it already has -- a single
# point inside a multi-square-kilometre perimeter carries no useful meaning.
RESITE_TYPES = {"Excavator", "Bulldozer", "Haul Truck", "Wheel Loader",
                "Motor Grader", "Rotary Drill Rig", "Service Truck",
                "Maintenance Vehicle", "Mobile Crane"}


def point_inside(lat: float, lng: float, polygon: list[dict]) -> bool:
    """Same even-odd ray-casting test as point_in_polygon() in schema.sql --
    kept identical in Python so this script's idea of "inside" can never
    silently drift from the database's."""
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]["lat"], polygon[i]["lng"]
        yj, xj = polygon[j]["lat"], polygon[j]["lng"]
        if (yi > lat) != (yj > lat):
            if lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside


def centroid(polygon: list[dict]) -> tuple[float, float]:
    return (sum(v["lat"] for v in polygon) / len(polygon),
            sum(v["lng"] for v in polygon) / len(polygon))


def bbox_extent(polygon: list[dict]) -> tuple[float, float]:
    lats = [v["lat"] for v in polygon]
    lngs = [v["lng"] for v in polygon]
    return max(lats) - min(lats), max(lngs) - min(lngs)


def jittered_point(rng: random.Random, polygon: list[dict]) -> tuple[float, float]:
    """A point inside `polygon`, spread across it rather than stacked at the
    centroid. Falls back to the exact centroid -- always inside a simple
    site polygon -- if twelve tries can't land one closer to the edges."""
    clat, clng = centroid(polygon)
    dlat, dlng = bbox_extent(polygon)
    for _ in range(12):
        lat = clat + rng.uniform(-0.35, 0.35) * dlat
        lng = clng + rng.uniform(-0.35, 0.35) * dlng
        if point_inside(lat, lng, polygon):
            return round(lat, 6), round(lng, 6)
    return round(clat, 6), round(clng, 6)


def main():
    if not settings.database_url:
        raise SystemExit("DATABASE_URL is not set")
    rng = random.Random(SEED)

    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        cur = conn.cursor()

        cur.execute("select id, polygon from zones")
        zones = {zid: poly for zid, poly in cur.fetchall()}

        cur.execute("""select m.machine_id, m.machine_type,
                              array_agg(a.zone_id order by a.zone_id) as zone_ids
                       from machines m
                       join machine_zone_assignments a on a.machine_id = m.machine_id
                       where m.machine_type = any(%s)
                       group by m.machine_id, m.machine_type
                       order by m.machine_type, m.machine_id""",
                    (list(RESITE_TYPES),))
        rows = cur.fetchall()

        counters: dict[str, int] = {}
        moved = 0
        for mid, mtype, zone_ids in rows:
            idx = counters.get(mtype, 0)
            counters[mtype] = idx + 1
            zid = zone_ids[idx % len(zone_ids)]   # spreads a multi-zone type across its zones
            lat, lng = jittered_point(rng, zones[zid])
            heading = round(rng.uniform(0, 360), 1)
            cur.execute("""update machines set lat=%s, lng=%s, heading_deg=%s,
                          position_updated_at=now() where machine_id=%s""",
                        (lat, lng, heading, mid))
            cur.execute("""insert into machine_position_history
                          (machine_id, lat, lng, heading_deg, source)
                          values (%s,%s,%s,%s,'simulated')""",
                        (mid, lat, lng, heading))
            moved += 1
        print(f"placed {moved} machines inside their assigned zone(s)")

        # Belt and braces: a Z-PERIMETER-only machine's EXISTING grid fix can
        # still coincide with a small restricted zone by chance (the grid was
        # laid out before zones existed). Nudge any such machine clear.
        cur.execute("""select machine_id, lat, lng from machines m
                       where exists (select 1 from zones z where z.kind = 'restricted'
                                      and point_in_polygon(m.lat, m.lng, z.polygon))""")
        offenders = cur.fetchall()
        cur.execute("select polygon from zones where kind = 'restricted'")
        restricted = [r[0] for r in cur.fetchall()]

        for mid, lat, lng in offenders:
            lat, lng = float(lat), float(lng)
            for _ in range(40):
                nlat = lat + rng.uniform(-0.006, 0.006)
                nlng = lng + rng.uniform(-0.006, 0.006)
                clear = not any(point_inside(nlat, nlng, poly) for poly in restricted)
                if clear:
                    cur.execute("""update machines set lat=%s, lng=%s,
                                  position_updated_at=now() where machine_id=%s""",
                                (round(nlat, 6), round(nlng, 6), mid))
                    cur.execute("""insert into machine_position_history
                                  (machine_id, lat, lng, source) values (%s,%s,%s,'simulated')""",
                                (mid, round(nlat, 6), round(nlng, 6)))
                    break
        if offenders:
            print(f"nudged {len(offenders)} machine(s) clear of a restricted zone "
                  f"(grid-seed coincidence, not a real incursion)")

        cur.execute("select count(*) from v_machine_geofence_status where not in_geofence")
        n_out = cur.fetchone()[0]
        cur.execute("select count(*) from v_machine_geofence_status where in_restricted_zones is not null")
        n_restricted = cur.fetchone()[0]
        cur.execute("""select min(haversine_m(a.lat, a.lng, b.lat, b.lng))
                       from machines a join machines b on a.machine_id < b.machine_id""")
        closest = cur.fetchone()[0]

        print(f"\nbaseline check:")
        print(f"  outside assigned geofence : {n_out}  (want 0)")
        print(f"  inside a restricted zone  : {n_restricted}  (want 0)")
        print(f"  closest machine pair      : {float(closest):.1f} m")
        if n_out or n_restricted:
            print("\n  NOT CLEAN -- investigate before treating this as a demo baseline.")
        else:
            print("\n  clean baseline: any alert from here on came from real movement.")


if __name__ == "__main__":
    main()
