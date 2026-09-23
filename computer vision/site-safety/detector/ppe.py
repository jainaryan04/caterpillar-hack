"""PPE compliance from raw YOLO boxes.

The model emits `person`, `helmet` and `vest` boxes independently, which on
their own answer the wrong question. "Two helmets in frame" says nothing about
whether the four people on site are protected. This module answers the useful
question -- is *this* person wearing a helmet and a vest -- and only reports a
violation once it has held for long enough to be real.

Pure stdlib: no torch, no cv2, so the logic is directly testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple

Box = Tuple[float, float, float, float]   # x1, y1, x2, y2


# --------------------------------------------------------------------------
# Tunables
# --------------------------------------------------------------------------


@dataclass
class Config:
    # --- detection ---
    conf: float = 0.35
    person_conf: float = 0.40
    min_person_height_frac: float = 0.06   # ignore specks in the far distance

    # --- gear -> person association ---
    # A helmet must sit in the top band of the person box, a vest across the
    # torso. Without these bands a helmet held in someone's hand, or one worn
    # by a person standing behind, would count as compliance.
    containment_min: float = 0.45          # gear area that must fall inside person
    helmet_band: Tuple[float, float] = (-0.08, 0.38)   # frac of person height
    vest_band: Tuple[float, float] = (0.12, 0.78)

    # --- temporal confirmation ---
    # A missed detection for a couple of frames is normal. A violation has to
    # persist before it is worth anyone's attention.
    violation_confirm_s: float = 1.50
    violation_clear_s: float = 1.00        # how long compliant before it closes
    track_iou_min: float = 0.30
    track_max_gap_s: float = 1.50          # keep a track alive through occlusion


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------


def area(b: Box) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def intersect(a: Box, b: Box) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def iou(a: Box, b: Box) -> float:
    inter = intersect(a, b)
    union = area(a) + area(b) - inter
    return inter / union if union > 1e-9 else 0.0


def containment(gear: Box, person: Box) -> float:
    """Fraction of the gear box that lies inside the person box."""
    ga = area(gear)
    return intersect(gear, person) / ga if ga > 1e-9 else 0.0


def _band_ok(gear: Box, person: Box, band: Tuple[float, float]) -> bool:
    """Is the gear's centre in the right vertical slice of the person?"""
    ph = person[3] - person[1]
    if ph <= 1e-9:
        return False
    cy = 0.5 * (gear[1] + gear[3])
    frac = (cy - person[1]) / ph
    return band[0] <= frac <= band[1]


# --------------------------------------------------------------------------
# Per-frame association
# --------------------------------------------------------------------------


@dataclass
class Detection:
    label: str            # person | helmet | vest
    box: Box
    conf: float


@dataclass
class PersonState:
    box: Box
    conf: float
    has_helmet: bool = False
    has_vest: bool = False
    helmet_conf: float = 0.0
    vest_conf: float = 0.0

    @property
    def missing(self) -> List[str]:
        out = []
        if not self.has_helmet:
            out.append("helmet")
        if not self.has_vest:
            out.append("vest")
        return out

    @property
    def compliant(self) -> bool:
        return self.has_helmet and self.has_vest


def associate(dets: List[Detection], frame_h: int, cfg: Config) -> List[PersonState]:
    """Attach each helmet/vest to at most one person.

    Assignment is greedy by confidence: the most confident gear box claims its
    best-fitting person first. One helmet cannot mark two overlapping people
    as compliant, which is the failure that makes a naive count-based check
    useless on a crowded site.
    """
    people = [
        PersonState(box=d.box, conf=d.conf)
        for d in dets
        if d.label == "person"
        and d.conf >= cfg.person_conf
        and (d.box[3] - d.box[1]) >= cfg.min_person_height_frac * frame_h
    ]
    if not people:
        return []

    gear = sorted(
        (d for d in dets if d.label in ("helmet", "vest") and d.conf >= cfg.conf),
        key=lambda d: -d.conf,
    )
    claimed = set()
    for g in gear:
        band = cfg.helmet_band if g.label == "helmet" else cfg.vest_band
        best, best_score = None, 0.0
        for idx, p in enumerate(people):
            if (idx, g.label) in claimed:
                continue
            c = containment(g.box, p.box)
            if c < cfg.containment_min or not _band_ok(g.box, p.box, band):
                continue
            if c > best_score:
                best, best_score = idx, c
        if best is not None:
            claimed.add((best, g.label))
            p = people[best]
            if g.label == "helmet":
                p.has_helmet, p.helmet_conf = True, g.conf
            else:
                p.has_vest, p.vest_conf = True, g.conf
    return people


# --------------------------------------------------------------------------
# Tracking + temporal confirmation
# --------------------------------------------------------------------------


@dataclass
class Violation:
    track_id: int
    missing: List[str]
    start: float
    end: float
    frames: int = 0
    best_frame: int = 0          # frame index of the clearest look at them
    best_conf: float = 0.0

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["duration"] = round(self.duration, 2)
        d["start"] = round(self.start, 2)
        d["end"] = round(self.end, 2)
        return d


@dataclass
class Track:
    track_id: int
    box: Box
    last_seen: float
    bad_since: Optional[float] = None
    good_since: Optional[float] = None
    open_violation: Optional[Violation] = None
    frames_seen: int = 0


class ComplianceMonitor:
    """Tracks people across frames and opens/closes violations over time."""

    def __init__(self, cfg: Optional[Config] = None):
        self.cfg = cfg or Config()
        self.tracks: Dict[int, Track] = {}
        self.violations: List[Violation] = []
        self._next_id = 1

    def _match(self, box: Box, now: float) -> Optional[Track]:
        best, best_iou = None, self.cfg.track_iou_min
        for t in self.tracks.values():
            if now - t.last_seen > self.cfg.track_max_gap_s:
                continue
            v = iou(box, t.box)
            if v >= best_iou:
                best, best_iou = t, v
        return best

    def update(self, people: List[PersonState], now: float, frame_idx: int) -> List[dict]:
        cfg = self.cfg
        rows = []
        matched = set()

        for p in people:
            t = self._match(p.box, now)
            if t is None or t.track_id in matched:
                t = Track(track_id=self._next_id, box=p.box, last_seen=now)
                self.tracks[t.track_id] = t
                self._next_id += 1
            matched.add(t.track_id)
            t.box, t.last_seen = p.box, now
            t.frames_seen += 1

            if p.compliant:
                t.bad_since = None
                if t.good_since is None:
                    t.good_since = now
                # Close an open violation once they have been compliant a while.
                if (t.open_violation is not None
                        and now - t.good_since >= cfg.violation_clear_s):
                    t.open_violation.end = now
                    t.open_violation = None
            else:
                t.good_since = None
                if t.bad_since is None:
                    t.bad_since = now
                elif (t.open_violation is None
                      and now - t.bad_since >= cfg.violation_confirm_s):
                    v = Violation(track_id=t.track_id, missing=p.missing,
                                  start=t.bad_since, end=now,
                                  best_frame=frame_idx, best_conf=p.conf)
                    self.violations.append(v)
                    t.open_violation = v
                if t.open_violation is not None:
                    t.open_violation.end = now
                    t.open_violation.frames += 1
                    t.open_violation.missing = p.missing
                    if p.conf > t.open_violation.best_conf:
                        t.open_violation.best_conf = p.conf
                        t.open_violation.best_frame = frame_idx

            rows.append({
                "track_id": t.track_id,
                "box": [round(c, 1) for c in p.box],
                "conf": round(p.conf, 3),
                "has_helmet": p.has_helmet,
                "has_vest": p.has_vest,
                "compliant": p.compliant,
                "missing": p.missing,
                "flagged": t.open_violation is not None,
            })

        # Retire tracks nobody has seen for a while.
        for tid in [k for k, t in self.tracks.items()
                    if now - t.last_seen > cfg.track_max_gap_s]:
            tr = self.tracks.pop(tid)
            if tr.open_violation is not None:
                tr.open_violation.end = tr.last_seen
        return rows

    def summary(self) -> dict:
        return {
            "people_tracked": self._next_id - 1,
            "violations": len(self.violations),
            "violation_list": [v.to_dict() for v in self.violations],
        }
