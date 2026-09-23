"""Proximity zones, closing-speed estimation and incident triggering.

Distance comes from metric depth, so zones are in real metres rather than pixel
heuristics. Closing speed is differentiated per track id, which is why the detector
runs with ByteTrack rather than plain detection.
"""

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

DANGER_M = 3.0      # stop zone
CAUTION_M = 7.0     # slow zone
TTC_ALERT_S = 3.0   # time-to-contact that trips an alert
SPEED_WINDOW_S = 1.5
INCIDENT_COOLDOWN_S = 8.0

GREEN, AMBER, RED = "GREEN", "AMBER", "RED"


def zone_for(distance_m):
    if distance_m is None:
        return GREEN
    if distance_m <= DANGER_M:
        return RED
    if distance_m <= CAUTION_M:
        return AMBER
    return GREEN


@dataclass
class ProximityState:
    zone: str = GREEN
    nearest_person_m: float | None = None
    nearest_obstacle_m: float | None = None
    people_in_danger: int = 0
    min_ttc_s: float | None = None
    alerts: list = field(default_factory=list)
    tracks: dict = field(default_factory=dict)  # track_id -> {distance, lateral, ttc, zone}


class ProximityMonitor:
    def __init__(self, now=time.monotonic):
        self._now = now
        self._history = defaultdict(lambda: deque(maxlen=30))  # track_id -> (ts, dist)
        self._last_incident_at = {}

    def _closing_speed(self, track_id, ts, distance):
        """Positive means approaching. Least-squares slope beats frame differencing,
        which is far too noisy on monocular depth."""
        hist = self._history[track_id]
        hist.append((ts, distance))
        recent = [(t, d) for t, d in hist if ts - t <= SPEED_WINDOW_S]
        if len(recent) < 4:
            return None
        t0 = recent[0][0]
        xs = [t - t0 for t, _ in recent]
        ys = [d for _, d in recent]
        n = len(xs)
        mx = sum(xs) / n
        my = sum(ys) / n
        denom = sum((x - mx) ** 2 for x in xs)
        if denom < 1e-6:
            return None
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / denom
        return -slope  # closing = distance shrinking

    def update(self, perception: dict) -> ProximityState:
        ts = self._now()
        state = ProximityState()
        if not perception:
            return state

        detections = perception.get("detections", []) or []
        obstacles = perception.get("obstacles", []) or []

        worst = GREEN
        nearest_person = None
        min_ttc = None

        for det in detections:
            dist = det.get("distance_m")
            if dist is None:
                continue
            tid = det.get("track_id", -1)
            zone = zone_for(dist)
            ttc = None

            if tid >= 0:
                speed = self._closing_speed(tid, ts, dist)
                if speed and speed > 0.2:  # ignore jitter and receding targets
                    ttc = dist / speed
                    if min_ttc is None or ttc < min_ttc:
                        min_ttc = ttc

            state.tracks[tid] = {
                "label": det.get("label"),
                "distance_m": dist,
                "lateral_m": det.get("lateral_m"),
                "ttc_s": round(ttc, 1) if ttc else None,
                "zone": zone,
                "is_person": det.get("is_person", False),
                "bbox_norm": det.get("bbox_norm"),
            }

            if det.get("is_person"):
                if nearest_person is None or dist < nearest_person:
                    nearest_person = dist
                if zone == RED:
                    state.people_in_danger += 1

            if zone == RED or (worst == GREEN and zone == AMBER):
                worst = RED if zone == RED else AMBER

        nearest_obstacle = obstacles[0]["distance_m"] if obstacles else None
        if nearest_obstacle is not None:
            ob_zone = zone_for(nearest_obstacle)
            if ob_zone == RED:
                worst = RED
            elif ob_zone == AMBER and worst == GREEN:
                worst = AMBER

        alerts = []
        if state.people_in_danger:
            alerts.append(
                f"STOP - {state.people_in_danger} person(s) inside {DANGER_M:.0f}m danger zone"
            )
        elif nearest_person is not None and nearest_person <= CAUTION_M:
            alerts.append(f"Worker {nearest_person:.1f}m ahead - slow down")

        if min_ttc is not None and min_ttc <= TTC_ALERT_S:
            alerts.append(f"Closing fast - contact in {min_ttc:.1f}s")

        if nearest_obstacle is not None and nearest_obstacle <= DANGER_M:
            alerts.append(f"Obstacle {nearest_obstacle:.1f}m in path")

        state.zone = worst
        state.nearest_person_m = nearest_person
        state.nearest_obstacle_m = nearest_obstacle
        state.min_ttc_s = round(min_ttc, 1) if min_ttc else None
        state.alerts = alerts
        return state

    def should_log_incident(self, kind: str) -> bool:
        """Rate-limit incidents so one event doesn't produce fifty log rows."""
        ts = self._now()
        last = self._last_incident_at.get(kind)
        if last is not None and ts - last < INCIDENT_COOLDOWN_S:
            return False
        self._last_incident_at[kind] = ts
        return True
