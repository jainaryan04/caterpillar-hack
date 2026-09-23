"""Temporal fatigue reasoning over per-frame driver signals.

A single frame cannot tell you someone is tired. PERCLOS - the fraction of time the
eyes are ≥80% closed over a rolling window - is the metric road-safety regulators
actually use, and it needs seconds of history. Everything here is deliberately
time-based rather than frame-based so that dropped frames skew nothing.
"""

import time
from collections import deque
from dataclasses import dataclass, field

# Thresholds. EAR is personalised at runtime; the rest are literature defaults.
BLINK_CLOSED = 0.55          # MediaPipe eyeBlink score above this reads as closed
EAR_CLOSED_RATIO = 0.72      # closed when EAR drops below this fraction of baseline
PERCLOS_WINDOW_S = 60.0
PERCLOS_WARN = 0.15
PERCLOS_CRITICAL = 0.28
MICROSLEEP_S = 1.0
YAWN_JAW_OPEN = 0.45
YAWN_MIN_S = 1.2
YAWN_WINDOW_S = 180.0
YAWN_WARN_COUNT = 3
HEAD_DROP_PITCH = -15.0
HEAD_DROP_S = 1.5
GAZE_AWAY_YAW = 35.0
GAZE_AWAY_S = 2.0
ABSENCE_S = 2.0
CALIBRATION_S = 4.0

OK, WARN, CRITICAL = "OK", "WARN", "CRITICAL"


@dataclass
class FatigueState:
    level: str = OK
    score: int = 0
    perclos: float = 0.0
    eyes_closed_for_s: float = 0.0
    yawns_recent: int = 0
    calibrated: bool = False
    alerts: list = field(default_factory=list)
    head_pose: dict = field(default_factory=dict)
    operator_present: bool = True


class FatigueMonitor:
    """Feeds on the driver-camera service output; emits a fused fatigue state."""

    def __init__(self, now=time.monotonic):
        self._now = now
        self._closure = deque()        # (ts, closed: bool)
        self._yawns = deque()          # ts of completed yawns
        self._ear_baseline_samples = []
        self._ear_baseline = None
        self._calibration_started = None

        self._closed_since = None
        self._yawn_started = None
        self._head_down_since = None
        self._gaze_away_since = None
        self._last_face_seen = None

    # ------------------------------------------------------------------ helpers

    def _prune(self, ts):
        while self._closure and ts - self._closure[0][0] > PERCLOS_WINDOW_S:
            self._closure.popleft()
        while self._yawns and ts - self._yawns[0] > YAWN_WINDOW_S:
            self._yawns.popleft()

    def _calibrate(self, ts, ear, closed_by_blendshape):
        """Learn this operator's open-eye EAR; eye shape varies a lot between people."""
        if self._ear_baseline is not None:
            return
        if self._calibration_started is None:
            self._calibration_started = ts
        if not closed_by_blendshape and ear > 0.1:
            self._ear_baseline_samples.append(ear)
        if ts - self._calibration_started >= CALIBRATION_S and self._ear_baseline_samples:
            ordered = sorted(self._ear_baseline_samples)
            # Upper-median: robust to blinks that slipped through.
            self._ear_baseline = ordered[int(len(ordered) * 0.6)]

    def _perclos(self, ts):
        if not self._closure:
            return 0.0
        span = ts - self._closure[0][0]
        if span < 1.0:
            return 0.0
        closed_time = 0.0
        for i in range(1, len(self._closure)):
            prev_ts, prev_closed = self._closure[i - 1]
            if prev_closed:
                closed_time += self._closure[i][0] - prev_ts
        return closed_time / span

    # -------------------------------------------------------------------- update

    def update(self, signal: dict) -> FatigueState:
        ts = self._now()
        self._prune(ts)

        if not signal or not signal.get("face_found"):
            if self._last_face_seen is None:
                self._last_face_seen = ts
            absent_for = ts - self._last_face_seen
            self._closed_since = None
            state = FatigueState(operator_present=False)
            if absent_for > ABSENCE_S:
                state.level = WARN
                state.score = 45
                state.alerts = [f"Operator not detected ({absent_for:.0f}s)"]
            return state

        self._last_face_seen = ts

        ear = float(signal.get("ear", 0.0))
        blink = float(signal.get("blink_score", 0.0))
        blend = signal.get("blendshapes", {}) or {}
        jaw_open = float(blend.get("jawOpen", signal.get("mar", 0.0)))
        pose = signal.get("head_pose", {}) or {}
        pitch = float(pose.get("pitch_deg", 0.0))
        yaw = float(pose.get("yaw_deg", 0.0))

        closed_by_blendshape = blink > BLINK_CLOSED
        self._calibrate(ts, ear, closed_by_blendshape)

        # Fuse two independent closure estimates; either alone is fragile.
        closed_by_ear = (
            self._ear_baseline is not None and ear < self._ear_baseline * EAR_CLOSED_RATIO
        )
        closed = closed_by_blendshape or closed_by_ear

        self._closure.append((ts, closed))

        if closed:
            if self._closed_since is None:
                self._closed_since = ts
        else:
            self._closed_since = None
        closed_for = ts - self._closed_since if self._closed_since else 0.0

        # Yawn: a sustained open jaw, counted once on completion.
        if jaw_open > YAWN_JAW_OPEN:
            if self._yawn_started is None:
                self._yawn_started = ts
        else:
            if self._yawn_started and ts - self._yawn_started >= YAWN_MIN_S:
                self._yawns.append(ts)
            self._yawn_started = None

        if pitch < HEAD_DROP_PITCH:
            self._head_down_since = self._head_down_since or ts
        else:
            self._head_down_since = None

        if abs(yaw) > GAZE_AWAY_YAW:
            self._gaze_away_since = self._gaze_away_since or ts
        else:
            self._gaze_away_since = None

        perclos = self._perclos(ts)

        # ------------------------------------------------------------- scoring
        alerts, score, level = [], 0, OK

        if closed_for >= MICROSLEEP_S:
            alerts.append(f"MICROSLEEP - eyes closed {closed_for:.1f}s")
            score = max(score, 100)
            level = CRITICAL
        elif closed_for >= 0.5:
            score = max(score, 40)

        if perclos >= PERCLOS_CRITICAL:
            alerts.append(f"Severe fatigue - PERCLOS {perclos:.0%}")
            score = max(score, 90)
            level = CRITICAL
        elif perclos >= PERCLOS_WARN:
            alerts.append(f"Fatigue building - PERCLOS {perclos:.0%}")
            score = max(score, 55)
            level = WARN if level == OK else level

        if len(self._yawns) >= YAWN_WARN_COUNT:
            alerts.append(f"{len(self._yawns)} yawns in 3 min")
            score = max(score, 50)
            level = WARN if level == OK else level

        if self._head_down_since and ts - self._head_down_since >= HEAD_DROP_S:
            alerts.append("Head drop detected")
            score = max(score, 80)
            level = CRITICAL

        if self._gaze_away_since and ts - self._gaze_away_since >= GAZE_AWAY_S:
            away = ts - self._gaze_away_since
            alerts.append(f"Eyes off path {away:.0f}s")
            score = max(score, 60)
            level = WARN if level == OK else level

        return FatigueState(
            level=level,
            score=int(score),
            perclos=perclos,
            eyes_closed_for_s=closed_for,
            yawns_recent=len(self._yawns),
            calibrated=self._ear_baseline is not None,
            alerts=alerts,
            head_pose={"pitch": pitch, "yaw": yaw, "roll": pose.get("roll_deg", 0.0)},
            operator_present=True,
        )
