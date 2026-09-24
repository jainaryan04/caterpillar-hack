"""Background GPS/safety telemetry simulator.

New module, additive only -- nothing here is imported by, or changes the
behaviour of, any v1 route. `main.py` starts `run_forever()` as a background
task at startup and cancels it at shutdown; every v1 route keeps working
identically whether this task is running or not.

Why a Python random walk instead of more SQL
----------------------------------------------
The schema (db/schema.sql, Phase 7/8) already has everything a detector needs:
`point_in_polygon`, `haversine_m`, `machine_in_geofence`, the views, and the
partial-unique-index anti-duplication scheme. What was explicitly NOT built
yet was the thing that changes machine positions over time and evaluates
those functions on a clock -- that is this file. It runs the six-condition
check (PROXIMITY, TILT, ROLLOVER, FALL, GEOFENCE_EXIT, RESTRICTED_ZONE) every
tick and keeps each OPEN event unique per the schema's own indexes, using an
explicit select-then-branch instead of ON CONFLICT so the conflict target
never has to match a partial index's predicate by accident.

Movement model
---------------
Every machine that is not FAULT/MAINTENANCE/OFFLINE takes a small random step
each tick, clamped to the site's bounding box. Pitch/roll mean-revert toward
level with small noise, plus a rare (~1%) sharp bump per machine per tick --
that bump is what produces real TILT/ROLLOVER/FALL alerts; the baseline
seeded by scripts/seed_gps_baseline.py stays clean until one actually occurs.
"""

from __future__ import annotations

import asyncio
import math
import random

import psycopg
from psycopg.rows import dict_row

from .settings import settings
from .store import store

TICK_SECONDS = 6
MAX_BACKOFF_SECONDS = 60    # a sustained outage should not retry every 6s forever
STEP_DEG = 0.00006          # ~6-7 m per tick -- visible movement, not a sprint
PITCH_ROLL_DECAY = 0.5      # mean-reversion toward level each tick
BUMP_CHANCE = 0.008         # per operating machine, per tick
IDLE_STATUSES = {"FAULT", "MAINTENANCE", "OFFLINE"}

_rng = random.Random()

# A dedicated connection, deliberately NOT borrowed from `store.pool`. That
# pool is sized (max 4) for request traffic; a tick that touches every
# machine is dozens of round trips and would sit in the pool for seconds,
# starving real API requests (and, worse, the test suite's own DB-gated
# tests) of a connection. One extra connection to a ~50-row database is free.
_conn: psycopg.Connection | None = None


def _connection() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed:
        _conn = psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=False)
    return _conn


async def run_forever() -> None:
    """Started once from the FastAPI lifespan; cancelled at shutdown.

    Backs off on consecutive failures (a misconfigured or briefly-unreachable
    database is a real, recoverable state, not a reason to hammer a
    connection attempt every 6 seconds forever) and resets to the normal
    cadence the moment a tick succeeds again.
    """
    consecutive_failures = 0
    while True:
        delay = TICK_SECONDS
        try:
            if store.enabled:
                await asyncio.to_thread(_tick)
                consecutive_failures = 0
        except Exception as e:  # a bad tick must never take the API down with it
            consecutive_failures += 1
            delay = min(TICK_SECONDS * 2 ** consecutive_failures, MAX_BACKOFF_SECONDS)
            if consecutive_failures <= 3 or consecutive_failures % 10 == 0:
                print(f"[simulator] tick failed ({consecutive_failures} in a row): {e!r}"
                      f" -- retrying in {delay}s")
            global _conn
            if _conn is not None:
                _conn.close()
                _conn = None
        await asyncio.sleep(delay)


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


def _tick() -> None:
    conn = _connection()
    with conn.transaction(), conn.cursor() as cur:
        # One prefetch of every currently-OPEN orientation/geofence event,
        # keyed for O(1) lookup, instead of a SELECT per machine per check.
        # At ~56 machines this is the difference between ~350 round trips to
        # Supabase and about a dozen -- the tick must fit well inside
        # TICK_SECONDS or it starts queueing behind itself.
        open_events = _OpenEvents(cur)
        _move_machines(cur, open_events)
        positions = cur.execute("select * from v_machine_positions").fetchall()
        _sync_tilt_and_rollover(cur, positions, open_events)
        _sync_proximity(cur, positions)
        _sync_geofence(cur, open_events)


class _OpenEvents:
    """Snapshot of every OPEN event at the start of a tick. `machine_id`
    columns key TILT/ROLLOVER/FALL/GEOFENCE_EXIT; RESTRICTED_ZONE additionally
    keys on `zone_id` since a machine can overlap more than one at once."""

    def __init__(self, cur):
        self.orientation: dict[tuple[str, str], int] = {
            (r["event_type"], r["machine_id"]): r["id"]
            for r in cur.execute(
                """select id, event_type, machine_id from machine_safety_events
                    where status = 'OPEN'
                      and event_type in ('TILT', 'ROLLOVER', 'FALL', 'GEOFENCE_EXIT')"""
            ).fetchall()
        }
        self.restricted: dict[str, dict[str, int]] = {}
        for r in cur.execute(
                """select id, machine_id, zone_id from machine_safety_events
                    where status = 'OPEN' and event_type = 'RESTRICTED_ZONE'""").fetchall():
            self.restricted.setdefault(r["machine_id"], {})[r["zone_id"]] = r["id"]


# --------------------------------------------------------------- movement ---

def _move_machines(cur, open_events: "_OpenEvents") -> None:
    machines = cur.execute(
        """select machine_id, machine_type, lat, lng, heading_deg, pitch_deg,
                  roll_deg, telemetry_status
             from machines"""
    ).fetchall()
    specs = {r["machine_type"]: r for r in cur.execute(
        "select * from machine_type_specs").fetchall()}
    default_spec = specs.get("*")
    site = cur.execute("select * from sites where id = 'SITE-01'").fetchone()

    updates: list[tuple] = []
    history: list[tuple] = []

    for m in machines:
        if m["telemetry_status"] in IDLE_STATUSES:
            continue
        spec = specs.get(m["machine_type"]) or default_spec

        heading = (float(m["heading_deg"]) + _rng.uniform(-20, 20)) % 360
        rad = math.radians(heading)
        new_lat = float(m["lat"]) + math.cos(rad) * STEP_DEG
        new_lng = float(m["lng"]) + math.sin(rad) * STEP_DEG
        if site:
            new_lat = min(max(new_lat, float(site["lat_min"])), float(site["lat_max"]))
            new_lng = min(max(new_lng, float(site["lng_min"])), float(site["lng_max"]))
        velocity = round(_rng.uniform(4, 22), 1) if m["telemetry_status"] == "OPERATING" else 0.0

        old_pitch, old_roll = float(m["pitch_deg"]), float(m["roll_deg"])
        pitch = old_pitch * PITCH_ROLL_DECAY + _rng.uniform(-1.5, 1.5)
        roll = old_roll * PITCH_ROLL_DECAY + _rng.uniform(-1.5, 1.5)
        if _rng.random() < BUMP_CHANCE:
            pitch += _rng.choice((-1, 1)) * _rng.uniform(15, 35)
            roll += _rng.choice((-1, 1)) * _rng.uniform(10, 25)
        pitch = max(-89.0, min(89.0, pitch))
        roll = max(-89.0, min(89.0, roll))

        angle_change = math.hypot(pitch - old_pitch, roll - old_roll)
        per_minute_limit = float(spec["sudden_change_deg_per_min"]) if spec else 18.0
        if angle_change > per_minute_limit * (TICK_SECONDS / 60):
            _raise_or_confirm(cur, open_events, "FALL", "CRITICAL", m["machine_id"],
                              lat=new_lat, lng=new_lng, pitch=pitch, roll=roll,
                              tilt=math.hypot(pitch, roll))

        row = (m["machine_id"], round(new_lat, 6), round(new_lng, 6), round(heading, 1),
               velocity, round(pitch, 1), round(roll, 1))
        updates.append(row)
        history.append(row)

    # Two bulk statements instead of two round trips per machine -- with ~50
    # moving machines that is the difference between ~100 round trips and 2,
    # which is what keeps a tick well inside TICK_SECONDS.
    row_sql = "(%s::text,%s::numeric,%s::numeric,%s::numeric,%s::numeric,%s::numeric,%s::numeric)"
    if updates:
        cur.execute(
            """update machines as m set
                    lat = v.lat, lng = v.lng, heading_deg = v.heading_deg,
                    velocity_kph = v.velocity_kph, pitch_deg = v.pitch_deg,
                    roll_deg = v.roll_deg, position_updated_at = now()
               from (values {}) as v(machine_id, lat, lng, heading_deg,
                                      velocity_kph, pitch_deg, roll_deg)
               where m.machine_id = v.machine_id""".format(",".join([row_sql] * len(updates))),
            [v for row in updates for v in row])
        cur.execute(
            """insert into machine_position_history
                    (machine_id, lat, lng, heading_deg, velocity_kph, pitch_deg, roll_deg, source)
               select v.machine_id, v.lat, v.lng, v.heading_deg, v.velocity_kph,
                      v.pitch_deg, v.roll_deg, 'simulated'
               from (values {}) as v(machine_id, lat, lng, heading_deg,
                                      velocity_kph, pitch_deg, roll_deg)""".format(
                ",".join([row_sql] * len(history))),
            [v for row in history for v in row])


# ---------------------------------------------------------- event helpers ---

def _raise_or_confirm(cur, open_events: "_OpenEvents", event_type: str, severity: str,
                      machine_id: str, *, lat: float, lng: float,
                      pitch: float | None = None, roll: float | None = None,
                      tilt: float | None = None, threshold: float | None = None) -> None:
    existing_id = open_events.orientation.get((event_type, machine_id))
    if existing_id:
        cur.execute(
            """update machine_safety_events set last_confirmed_at = now(),
                    pitch_deg = coalesce(%s, pitch_deg), roll_deg = coalesce(%s, roll_deg),
                    tilt_deg = coalesce(%s, tilt_deg) where id = %s""",
            (pitch, roll, tilt, existing_id))
    else:
        new_id = cur.execute(
            """insert into machine_safety_events
                    (event_type, severity, machine_id, lat, lng, pitch_deg, roll_deg,
                     tilt_deg, threshold_deg)
               values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
            (event_type, severity, machine_id, lat, lng, pitch, roll, tilt, threshold)
        ).fetchone()["id"]
        open_events.orientation[(event_type, machine_id)] = new_id


def _resolve(cur, event_id: int) -> None:
    cur.execute(
        "update machine_safety_events set status = 'RESOLVED', resolved_at = now()"
        " where id = %s", (event_id,))


# --------------------------------------------------------- tilt/rollover ---
# FALL is raised inline in _move_machines (it needs the tick's angle DELTA,
# which is gone by the time we re-read positions here) and is never
# auto-resolved -- a fall already happened; clearing it is a human call.

def _sync_tilt_and_rollover(cur, positions: list[dict], open_events: "_OpenEvents") -> None:
    for p in positions:
        tilt = float(p["tilt_deg"] or 0)
        warn, crit = float(p["tilt_warning_deg"]), float(p["tilt_critical_deg"])
        wanted = "ROLLOVER" if tilt >= crit else "TILT" if tilt >= warn else None
        mid = p["machine_id"]
        for et in ("TILT", "ROLLOVER"):
            if et == wanted:
                _raise_or_confirm(cur, open_events, et,
                                  "CRITICAL" if et == "ROLLOVER" else "MEDIUM", mid,
                                  lat=p["lat"], lng=p["lng"], pitch=p["pitch_deg"],
                                  roll=p["roll_deg"], tilt=tilt,
                                  threshold=crit if et == "ROLLOVER" else warn)
            else:
                existing_id = open_events.orientation.pop((et, mid), None)
                if existing_id:
                    _resolve(cur, existing_id)


# -------------------------------------------------------------- proximity ---

def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(float(lat1)), math.radians(float(lat2))
    dp = math.radians(float(lat2) - float(lat1))
    dl = math.radians(float(lng2) - float(lng1))
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return r * 2 * math.asin(min(1.0, math.sqrt(a)))


def _sync_proximity(cur, positions: list[dict]) -> None:
    close: dict[tuple[str, str], tuple[float, float, float, float]] = {}
    for i in range(len(positions)):
        a = positions[i]
        if a["reservation_status"] == "MAINTENANCE":
            continue
        for j in range(i + 1, len(positions)):
            b = positions[j]
            if b["reservation_status"] == "MAINTENANCE":
                continue
            dist = _haversine_m(a["lat"], a["lng"], b["lat"], b["lng"])
            threshold = max(float(a["proximity_threshold_m"]), float(b["proximity_threshold_m"]))
            if dist <= threshold:
                pair = tuple(sorted((a["machine_id"], b["machine_id"])))
                close[pair] = (dist, threshold, float(a["lat"]), float(a["lng"]))

    open_rows = cur.execute(
        """select id, machine_id, other_machine_id from machine_safety_events
            where status = 'OPEN' and event_type = 'PROXIMITY'""").fetchall()
    open_by_pair = {tuple(sorted((r["machine_id"], r["other_machine_id"]))): r["id"]
                    for r in open_rows}

    for pair, (dist, threshold, lat, lng) in close.items():
        if pair in open_by_pair:
            cur.execute(
                "update machine_safety_events set last_confirmed_at = now(),"
                " distance_m = %s where id = %s", (round(dist, 1), open_by_pair[pair]))
        else:
            cur.execute(
                """insert into machine_safety_events
                        (event_type, severity, machine_id, other_machine_id, lat, lng,
                         distance_m, threshold_m)
                   values ('PROXIMITY', %s, %s, %s, %s, %s, %s, %s)""",
                ("HIGH" if dist < threshold * 0.5 else "MEDIUM", pair[0], pair[1],
                 lat, lng, round(dist, 1), threshold))

    for pair, rid in open_by_pair.items():
        if pair not in close:
            _resolve(cur, rid)


# ---------------------------------------------------------------- geofence --

def _sync_geofence(cur, open_events: "_OpenEvents") -> None:
    rows = cur.execute("select * from v_machine_geofence_status").fetchall()
    for r in rows:
        mid = r["machine_id"]
        if not r["in_geofence"] and r["assigned_zones"]:
            _raise_or_confirm(cur, open_events, "GEOFENCE_EXIT", "MEDIUM", mid,
                              lat=r["lat"], lng=r["lng"])
        else:
            existing_id = open_events.orientation.pop(("GEOFENCE_EXIT", mid), None)
            if existing_id:
                _resolve(cur, existing_id)

        current_zones = set(r["in_restricted_zones"] or [])
        open_zone_ids = open_events.restricted.get(mid, {})

        for zid in current_zones - open_zone_ids.keys():
            cur.execute(
                """insert into machine_safety_events
                        (event_type, severity, machine_id, zone_id, lat, lng)
                   values ('RESTRICTED_ZONE', 'HIGH', %s, %s, %s, %s)""",
                (mid, zid, r["lat"], r["lng"]))
        for zid, event_id in open_zone_ids.items():
            if zid not in current_zones:
                _resolve(cur, event_id)
