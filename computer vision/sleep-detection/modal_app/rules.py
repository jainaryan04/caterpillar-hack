"""Rule-based drowsiness state machine.

Pure stdlib + numpy so it runs identically on Modal and on a local client.
Everything is driven by wall-clock timestamps rather than frame counts, so the
verdict is stable whether the camera delivers 8 fps or 30 fps.

The engine consumes per-frame facial measurements (see `FrameSignals`) and
maintains sliding-window state to answer three questions:

  1. Are the eyes closed for longer than a blink? (microsleep / PERCLOS)
  2. Is the mouth held wide open for longer than speech? (yawning)
  3. Is the head nodding off?

It deliberately does NOT look at a single frame in isolation -- a closed eye in
one frame is a blink, a closed eye for a second is a safety event.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Deque, Optional

# --------------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------------


@dataclass
class Thresholds:
    # --- eye closure ---
    # A person's "open" EAR varies a lot (eye shape, glasses, camera angle), so
    # closure is judged relative to that driver's own adaptive baseline.
    eye_closed_ratio: float = 0.65        # closed if ear < ratio * baseline
    ear_baseline_default: float = 0.28    # used until enough open frames seen
    ear_baseline_min: float = 0.15        # clamp so a bad baseline can't blind us
    ear_baseline_max: float = 0.45
    baseline_window_s: float = 90.0
    blink_blendshape: float = 0.55        # mediapipe eyeBlink_* fallback

    # --- blink vs microsleep ---
    blink_max_s: float = 0.55             # <= this is an ordinary blink: ignored
    microsleep_s: float = 1.00            # >= this is a microsleep: serious
    long_closure_s: float = 2.50          # >= this is eyes-shut: critical

    # --- PERCLOS (percent eyelid closure over time) ---
    perclos_window_s: float = 60.0
    # Deliberately weighted so PERCLOS alone tops out at MILD: a driver is
    # alerted for eyes *shut for a while*, not for blinking often.
    perclos_mild: float = 0.18
    perclos_drowsy: float = 0.28
    # PERCLOS is a percentage *over time*. Until this much face-visible time
    # has accumulated it is noise -- a session opening mid-blink would
    # otherwise read 100% off a single frame.
    perclos_min_observed_s: float = 15.0

    # --- yawning ---
    # "Fully open", not "open": speech peaks well below these, so talking
    # cannot start a yawn episode at all.
    mouth_open_mar: float = 0.72          # mouth aspect ratio threshold
    jaw_open_blendshape: float = 0.60     # mediapipe jawOpen
    yawn_min_s: float = 1.50              # sustained -> yawn, not speech
    yawn_max_s: float = 8.00              # longer than this is not a yawn
    yawn_window_s: float = 300.0
    yawn_drowsy_count: int = 3            # yawns in window that mean trouble

    # --- head posture ---
    # Pitch is measured against the driver's own learned forward pitch: a
    # normal forward gaze already reads about -10 deg on a dash-mounted
    # camera, and that offset changes with every mounting.
    pitch_drop_deg: float = 18.0          # this far below their normal = chin down
    pitch_drop_abs_deg: float = 25.0      # absolute fallback before baseline exists
    yaw_away_deg: float = 35.0            # head turned this far off-axis
    roll_tilt_deg: float = 28.0           # head tipping onto a shoulder
    head_drop_s: float = 1.20             # sustained before it counts
    head_drop_bad_s: float = 2.50         # sustained this long is severe
    pitch_baseline_window_s: float = 60.0
    pitch_baseline_min_samples: int = 30

    # Face gone this long means the head is turned right away or the driver
    # has slumped out of frame. Silence is the wrong answer there.
    face_lost_alert_s: float = 3.00
    face_lost_bad_s: float = 6.00

    # --- housekeeping ---
    max_dt_s: float = 0.50                # cap gaps so a stall can't skew windows
    face_window_s: float = 10.0           # "can I see the driver right now?"
    smoothing_frames: int = 3             # median filter on EAR / MAR
    event_recency_s: float = 30.0         # how long an event keeps scoring
    face_required_ratio: float = 0.40     # below this, verdict is UNKNOWN

    # --- score -> level ---
    level_mild: float = 25.0
    level_drowsy: float = 50.0
    level_critical: float = 75.0


# --------------------------------------------------------------------------
# Inputs / outputs
# --------------------------------------------------------------------------


@dataclass
class FrameSignals:
    """Per-frame measurements handed to the state machine."""

    timestamp: float                       # seconds, monotonic-ish wall clock
    face_found: bool
    ear: Optional[float] = None            # eye aspect ratio (both eyes averaged)
    mar: Optional[float] = None            # mouth aspect ratio
    blink_score: Optional[float] = None    # mediapipe eyeBlink_* (0..1)
    jaw_open_score: Optional[float] = None # mediapipe jawOpen (0..1)
    pitch_deg: Optional[float] = None      # head pitch, negative = looking down
    yaw_deg: Optional[float] = None        # head turned left/right
    roll_deg: Optional[float] = None       # head tipped toward a shoulder
    face_confidence: float = 0.0


@dataclass
class Event:
    kind: str          # "microsleep" | "long_closure" | "yawn" | "nod"
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass
class Verdict:
    level: str                  # ALERT | MILD | DROWSY | CRITICAL | UNKNOWN
    score: float                # 0..100
    sleepy: bool                # level is DROWSY or CRITICAL
    reasons: list = field(default_factory=list)
    perclos: float = 0.0
    eyes_closed: bool = False
    closure_s: float = 0.0      # length of the closure in progress
    mouth_open: bool = False
    yawn_s: float = 0.0
    yawns_in_window: int = 0
    microsleeps_recent: int = 0
    avg_blink_s: float = 0.0
    blink_rate_per_min: float = 0.0
    ear: Optional[float] = None
    mar: Optional[float] = None
    ear_baseline: float = 0.0
    pitch_deg: Optional[float] = None
    yaw_deg: Optional[float] = None
    roll_deg: Optional[float] = None
    pitch_baseline: Optional[float] = None
    head_state: str = "forward"   # forward | down | turned | tilted
    head_drop_s: float = 0.0
    face_lost_s: float = 0.0
    face_found: bool = False
    face_visible_ratio: float = 1.0
    session_s: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


# --------------------------------------------------------------------------
# State machine
# --------------------------------------------------------------------------


def _median(vals) -> float:
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return 0.0
    mid = n // 2
    return s[mid] if n % 2 else 0.5 * (s[mid - 1] + s[mid])


def _percentile(vals, q: float) -> float:
    """Linear-interpolated percentile; avoids a numpy dependency here."""
    s = sorted(vals)
    if not s:
        return 0.0
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * q
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return s[int(pos)]
    return s[lo] * (hi - pos) + s[hi] * (pos - lo)


class DrowsinessMonitor:
    """Sliding-window rule engine. One instance per driver session."""

    def __init__(self, thresholds: Optional[Thresholds] = None):
        self.t = thresholds or Thresholds()
        self.reset()

    # -- lifecycle ---------------------------------------------------------

    def reset(self) -> None:
        t = self.t
        self._first_ts: Optional[float] = None
        self._last_ts: Optional[float] = None

        self._ear_buf: Deque[float] = deque(maxlen=max(1, t.smoothing_frames))
        self._mar_buf: Deque[float] = deque(maxlen=max(1, t.smoothing_frames))

        # (ts, ear) for open-eye frames, used to learn this driver's baseline
        self._baseline_samples: Deque[tuple] = deque()
        self._ear_baseline = t.ear_baseline_default

        # (ts, dt, closed) for PERCLOS and face-visibility ratios
        self._perclos_win: Deque[tuple] = deque()
        self._face_win: Deque[tuple] = deque()

        self._closure_start: Optional[float] = None
        self._closure_counted: bool = False   # microsleep already emitted
        self._yawn_start: Optional[float] = None
        self._yawn_counted: bool = False
        self._head_start: Optional[float] = None
        self._head_counted: bool = False
        self._head_state: str = "forward"
        self._pitch_samples: Deque[tuple] = deque()
        self._pitch_baseline: Optional[float] = None
        self._face_lost_since: Optional[float] = None
        self._face_lost_s: float = 0.0

        self._events: Deque[Event] = deque()
        self._blinks: Deque[tuple] = deque()  # (ts, duration)

    # -- helpers -----------------------------------------------------------

    def _trim(self, dq: Deque[tuple], now: float, window: float) -> None:
        """Drop (timestamp, ...) tuples that have aged out of the window."""
        while dq and now - dq[0][0] > window:
            dq.popleft()

    def _trim_events(self, now: float, window: float) -> None:
        """Same, for the Event deque, which is ordered by when each ended."""
        while self._events and now - self._events[0].end > window:
            self._events.popleft()

    def _update_baseline(self, ts: float, ear: float) -> None:
        """Learn the driver's open-eye EAR from the upper end of the spread.

        The 85th percentile is used rather than the max so a single wide-eyed
        frame or a landmark glitch cannot inflate the baseline and make real
        closures look normal.
        """
        t = self.t
        self._baseline_samples.append((ts, ear))
        self._trim(self._baseline_samples, ts, t.baseline_window_s)
        if len(self._baseline_samples) >= 15:
            p85 = _percentile([e for _, e in self._baseline_samples], 0.85)
            self._ear_baseline = min(
                t.ear_baseline_max, max(t.ear_baseline_min, p85)
            )

    def _is_closed(self, sig: FrameSignals, ear: Optional[float]) -> bool:
        t = self.t
        if sig.blink_score is not None:
            return sig.blink_score >= t.blink_blendshape
        if ear is None:
            return False
        return ear < t.eye_closed_ratio * self._ear_baseline

    def _is_mouth_open(self, sig: FrameSignals, mar: Optional[float]) -> bool:
        """Either signal crossing counts as an open mouth.

        These two degrade in different ways. On samples/yawning_woman_720p.mp4
        a hand across the mouth held jawOpen at 0.63 for barely 290 ms while
        geometric MAR read 0.83 across 20 frames -- preferring the blendshape
        threw the better signal away and missed the yawn outright. Fusing is
        safe here because the 1.2 s duration gate, not the threshold, is what
        separates a yawn from speech.

        Eye closure deliberately does *not* fuse this way: on the driver clip
        the blendshape agreed with EAR on 46 of 79 low-EAR frames, and OR-ing
        them would have stitched ordinary blinks into phantom microsleeps.
        """
        t = self.t
        if sig.jaw_open_score is not None and sig.jaw_open_score >= t.jaw_open_blendshape:
            return True
        if mar is not None and mar >= t.mouth_open_mar:
            return True
        return False

    # -- main entry point --------------------------------------------------

    def update(self, sig: FrameSignals) -> Verdict:
        t = self.t
        now = sig.timestamp

        if self._first_ts is None:
            self._first_ts = now
        # Guard against out-of-order or duplicate frames from a lossy client.
        if self._last_ts is not None and now < self._last_ts:
            now = self._last_ts
        dt = 0.0 if self._last_ts is None else min(now - self._last_ts, t.max_dt_s)
        self._last_ts = now

        self._face_win.append((now, dt, sig.face_found))
        # Visibility is judged over a short window, not the whole PERCLOS
        # window: once the driver's face is back, the verdict should recover in
        # seconds rather than stay UNKNOWN for another minute.
        self._trim(self._face_win, now, t.face_window_s)

        ear = mar = None
        if sig.face_found:
            if sig.ear is not None:
                self._ear_buf.append(sig.ear)
                ear = _median(self._ear_buf)
            if sig.mar is not None:
                self._mar_buf.append(sig.mar)
                mar = _median(self._mar_buf)
        else:
            # Face lost: we cannot assert anything about the eyes, so end any
            # open episode instead of letting it run and fake a microsleep.
            self._ear_buf.clear()
            self._mar_buf.clear()
            self._end_closure(now, aborted=True)
            self._end_yawn(now, aborted=True)
            # A head turned far enough to lose the face is itself the signal,
            # so the head episode is NOT reset here -- see _track_face_loss.
            if self._face_lost_since is None:
                self._face_lost_since = now
        if sig.face_found:
            self._face_lost_since = None
        self._face_lost_s = (
            0.0 if self._face_lost_since is None else now - self._face_lost_since
        )

        closed = False
        if sig.face_found:
            closed = self._is_closed(sig, ear)
            if not closed and ear is not None:
                self._update_baseline(now, ear)
            self._track_closure(now, closed)
            self._track_yawn(now, self._is_mouth_open(sig, mar))
            self._track_head(now, sig)

        # PERCLOS only counts time where we actually saw the face.
        if sig.face_found:
            self._perclos_win.append((now, dt, closed))
        self._trim(self._perclos_win, now, t.perclos_window_s)
        self._trim_events(now, max(t.yawn_window_s, t.perclos_window_s))
        self._trim(self._blinks, now, t.perclos_window_s)

        return self._score(now, sig, ear, mar, closed)

    # -- episode tracking --------------------------------------------------

    def _track_closure(self, now: float, closed: bool) -> None:
        if closed:
            if self._closure_start is None:
                self._closure_start = now
                self._closure_counted = False
            else:
                dur = now - self._closure_start
                # Emit as soon as the threshold is crossed so an alarm fires
                # mid-closure rather than only once the driver reopens.
                if dur >= self.t.microsleep_s and not self._closure_counted:
                    self._events.append(Event("microsleep", self._closure_start, now))
                    self._closure_counted = True
                elif dur >= self.t.long_closure_s and self._closure_counted:
                    if self._events and self._events[-1].kind in (
                        "microsleep",
                        "long_closure",
                    ):
                        self._events[-1].kind = "long_closure"
                        self._events[-1].end = now
        else:
            self._end_closure(now)

    def _end_closure(self, now: float, aborted: bool = False) -> None:
        if self._closure_start is None:
            return
        dur = now - self._closure_start
        if not aborted and not self._closure_counted and dur <= self.t.blink_max_s:
            self._blinks.append((now, dur))
        self._closure_start = None
        self._closure_counted = False

    def _track_yawn(self, now: float, open_mouth: bool) -> None:
        if open_mouth:
            if self._yawn_start is None:
                self._yawn_start = now
                self._yawn_counted = False
            else:
                dur = now - self._yawn_start
                if (
                    not self._yawn_counted
                    and self.t.yawn_min_s <= dur <= self.t.yawn_max_s
                ):
                    self._events.append(Event("yawn", self._yawn_start, now))
                    self._yawn_counted = True
        else:
            self._end_yawn(now)

    def _end_yawn(self, now: float, aborted: bool = False) -> None:
        self._yawn_start = None
        self._yawn_counted = False

    def _update_pitch_baseline(self, now: float, pitch: float) -> None:
        """Learn this driver's normal forward pitch.

        A dash-mounted camera looks up at the face, so a perfectly attentive
        driver can sit at -10 deg all day. Judging a chin-drop against an
        absolute angle would either fire constantly or never; judging it
        against their own median does neither.
        """
        t = self.t
        self._pitch_samples.append((now, pitch))
        self._trim(self._pitch_samples, now, t.pitch_baseline_window_s)
        if len(self._pitch_samples) >= t.pitch_baseline_min_samples:
            self._pitch_baseline = _median([p for _, p in self._pitch_samples])

    def _classify_head(self, sig: FrameSignals) -> str:
        """forward | down | turned | tilted -- posture for this frame alone."""
        t = self.t
        # Turned or tipped is judged on magnitude, so the sign convention of
        # the transformation matrix cannot silently invert the rule.
        if sig.yaw_deg is not None and abs(sig.yaw_deg) >= t.yaw_away_deg:
            return "turned"
        if sig.roll_deg is not None and abs(sig.roll_deg) >= t.roll_tilt_deg:
            return "tilted"
        if sig.pitch_deg is not None:
            if self._pitch_baseline is not None:
                if sig.pitch_deg <= self._pitch_baseline - t.pitch_drop_deg:
                    return "down"
            elif sig.pitch_deg <= -t.pitch_drop_abs_deg:
                return "down"
        return "forward"

    def _track_head(self, now: float, sig: FrameSignals) -> None:
        state = self._classify_head(sig)
        self._head_state = state

        if state == "forward":
            if sig.pitch_deg is not None:
                self._update_pitch_baseline(now, sig.pitch_deg)
            self._head_start = None
            self._head_counted = False
            return

        if self._head_start is None:
            self._head_start = now
            self._head_counted = False
        elif not self._head_counted and now - self._head_start >= self.t.head_drop_s:
            self._events.append(Event(f"head_{state}", self._head_start, now))
            self._head_counted = True

    # -- scoring -----------------------------------------------------------

    def _score(self, now, sig, ear, mar, closed) -> Verdict:
        t = self.t

        face_time = sum(d for _, d, _ in self._face_win)
        face_seen = sum(d for _, d, f in self._face_win if f)
        face_ratio = (face_seen / face_time) if face_time > 0 else 1.0

        seen = sum(d for _, d, _ in self._perclos_win)
        shut = sum(d for _, d, c in self._perclos_win if c)
        perclos = (shut / seen) if seen > 0 else 0.0

        recent = [e for e in self._events if now - e.end <= t.event_recency_s]
        microsleeps = [e for e in recent if e.kind in ("microsleep", "long_closure")]
        long_closures = [e for e in recent if e.kind == "long_closure"]
        head_events = [e for e in recent if e.kind.startswith("head_")]
        yawns = [e for e in self._events
                 if e.kind == "yawn" and now - e.end <= t.yawn_window_s]

        blink_durs = [d for _, d in self._blinks]
        avg_blink = sum(blink_durs) / len(blink_durs) if blink_durs else 0.0
        win_min = max(seen, 1e-6) / 60.0
        blink_rate = len(blink_durs) / win_min if seen > 1.0 else 0.0

        closure_s = (now - self._closure_start) if self._closure_start else 0.0
        yawn_s = (now - self._yawn_start) if self._yawn_start else 0.0
        head_s = (now - self._head_start) if self._head_start else 0.0
        lost_s = self._face_lost_s

        score = 0.0
        reasons = []

        # --- 1. eyes shut for a while -------------------------------------
        if closure_s >= t.long_closure_s:
            score += 80.0
            reasons.append(f"eyes closed {closure_s:.1f}s")
        elif closure_s >= t.microsleep_s:
            score += 55.0
            reasons.append(f"eyes closed {closure_s:.1f}s")

        if long_closures:
            score += 35.0
            reasons.append(f"{len(long_closures)} prolonged closure(s) recently")
        elif microsleeps:
            score += min(45.0, 22.0 * len(microsleeps))
            reasons.append(f"{len(microsleeps)} microsleep(s) in last 30s")

        # --- 2. head posture ----------------------------------------------
        # A driver dozing off drops their chin or lets their head roll to one
        # side, and the eyes are usually invisible by then. This has to be a
        # primary signal, not a tie-breaker.
        head_label = {"down": "head dropped", "turned": "head turned away",
                      "tilted": "head tilted over"}
        if head_s >= t.head_drop_bad_s and self._head_state != "forward":
            score += 80.0
            reasons.append(f"{head_label[self._head_state]} {head_s:.1f}s")
        elif head_s >= t.head_drop_s and self._head_state != "forward":
            score += 55.0
            reasons.append(f"{head_label[self._head_state]} {head_s:.1f}s")
        elif head_events:
            score += 30.0
            reasons.append("head posture lapse recently")

        # --- 3. face not visible at all ------------------------------------
        # Losing the face for seconds means the head is turned right away or
        # the driver has slumped out of frame. Reporting UNKNOWN there would
        # go quiet at the exact moment it matters.
        if lost_s >= t.face_lost_bad_s:
            score += 75.0
            reasons.append(f"face not visible {lost_s:.0f}s - head away?")
        elif lost_s >= t.face_lost_alert_s:
            score += 45.0
            reasons.append(f"face not visible {lost_s:.1f}s")

        # --- 4. mouth fully open for a long time ---------------------------
        if yawn_s >= t.yawn_min_s:
            score += 50.0
            reasons.append(f"mouth wide open {yawn_s:.1f}s")
        if len(yawns) >= t.yawn_drowsy_count:
            score += 25.0
            reasons.append(f"{len(yawns)} yawns in {int(t.yawn_window_s/60)} min")
        elif yawns:
            score += 12.0 * len(yawns)
            reasons.append(f"{len(yawns)} yawn(s)")

        # --- 5. PERCLOS, capped so it cannot reach DROWSY on its own -------
        perclos_ready = seen >= t.perclos_min_observed_s
        if perclos_ready and perclos >= t.perclos_drowsy:
            score += 25.0
            reasons.append(f"PERCLOS {perclos:.0%}")
        elif perclos_ready and perclos >= t.perclos_mild:
            score += 15.0
            reasons.append(f"PERCLOS {perclos:.0%}")

        # Blink rate and blink duration are reported but deliberately not
        # scored: ordinary blinking must never raise an alert.

        score = max(0.0, min(100.0, score))

        # A brief patch of lost detection means "I cannot tell". A sustained
        # one was already scored above as a head-away alert, so it must not be
        # silenced here.
        if face_ratio < t.face_required_ratio and lost_s < t.face_lost_alert_s:
            level = "UNKNOWN"
            reasons = ["face not visible"]
            score = 0.0
        elif score >= t.level_critical:
            level = "CRITICAL"
        elif score >= t.level_drowsy:
            level = "DROWSY"
        elif score >= t.level_mild:
            level = "MILD"
        else:
            level = "ALERT"
            if not reasons:
                reasons = ["normal"]

        return Verdict(
            level=level,
            score=round(score, 1),
            sleepy=level in ("DROWSY", "CRITICAL"),
            reasons=reasons,
            perclos=round(perclos, 4),
            eyes_closed=bool(closed),
            closure_s=round(closure_s, 2),
            mouth_open=bool(yawn_s > 0),
            yawn_s=round(yawn_s, 2),
            yawns_in_window=len(yawns),
            microsleeps_recent=len(microsleeps),
            avg_blink_s=round(avg_blink, 3),
            blink_rate_per_min=round(blink_rate, 1),
            ear=round(ear, 4) if ear is not None else None,
            mar=round(mar, 4) if mar is not None else None,
            ear_baseline=round(self._ear_baseline, 4),
            pitch_deg=round(sig.pitch_deg, 1) if sig.pitch_deg is not None else None,
            yaw_deg=round(sig.yaw_deg, 1) if sig.yaw_deg is not None else None,
            roll_deg=round(sig.roll_deg, 1) if sig.roll_deg is not None else None,
            pitch_baseline=(round(self._pitch_baseline, 1)
                            if self._pitch_baseline is not None else None),
            head_state=self._head_state,
            head_drop_s=round(head_s, 2),
            face_lost_s=round(lost_s, 2),
            face_found=sig.face_found,
            face_visible_ratio=round(face_ratio, 3),
            session_s=round(now - (self._first_ts or now), 2),
        )
