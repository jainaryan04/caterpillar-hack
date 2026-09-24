"""Fusing a detection box with the depth map into a proximity score.

The score is RELATIVE. Depth Anything V2 emits inverse depth with no metric
scale, so a proximity of 0.8 means "near the front of the depth range this
camera is seeing", not a number of metres. Two consequences worth stating
plainly, because they decide whether this is safe to build on:

  * Scores are comparable *within* a frame -- object A is nearer than object B
    is a claim the model supports well.
  * Scores are only comparable *across* frames if the reference range is held
    fixed, which is what ProximityScorer does with a clip-wide range.

Turning this into metres needs calibration -- see the README.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Optional

import numpy as np

from detect import Detection


@dataclass
class ScoredDetection:
    """A detection with depth attached."""

    label: str
    kind: str
    confidence: float
    box: tuple[int, int, int, int]
    depth_raw: float        # inverse depth of the object's near surface
    proximity: float        # 0-1 against the reference range; 1 = nearest
    level: str              # CLEAR | WARN | ALERT
    source: str = "coco"    # detector that found it

    def as_dict(self) -> dict:
        d = asdict(self)
        d["box"] = list(self.box)
        d["depth_raw"] = round(self.depth_raw, 4)
        d["proximity"] = round(self.proximity, 4)
        d["confidence"] = round(self.confidence, 4)
        return d


def box_depth(depth: np.ndarray, box, shrink: float = 0.2, pct: float = 80.0) -> float:
    """Inverse depth of the near surface of whatever is in `box`.

    Two deliberate choices:

    * **Shrink to the central region.** A bounding box is a rectangle around a
      non-rectangular thing, so its corners are background. On a person the
      corners are literally the scene behind them, which would drag the value
      toward "far" exactly when they step close.
    * **A high percentile, not the mean or the max.** The alert cares about the
      closest part of the object -- an outstretched arm, a bucket -- but the
      single max pixel is noise. p80 of the central region tracks the near
      surface without chasing speckle.
    """
    h, w = depth.shape
    x1, y1, x2, y2 = box
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    if x2 <= x1 or y2 <= y1:
        return float("nan")

    dx = int((x2 - x1) * shrink / 2)
    dy = int((y2 - y1) * shrink / 2)
    # Only shrink while a patch survives it; tiny far-away boxes keep their size.
    if (x2 - x1) - 2 * dx >= 3 and (y2 - y1) - 2 * dy >= 3:
        x1, y1, x2, y2 = x1 + dx, y1 + dy, x2 - dx, y2 - dy

    patch = depth[y1:y2, x1:x2]
    if patch.size == 0:
        return float("nan")
    return float(np.percentile(patch, pct))


def frame_range(depth: np.ndarray, lo_pct: float = 1.0, hi_pct: float = 99.0):
    """Percentile depth range of one frame, as a fallback reference."""
    return float(np.percentile(depth, lo_pct)), float(np.percentile(depth, hi_pct))


class ProximityScorer:
    """Scores detections against a depth map and a reference range.

    Pass `reference` to hold the range fixed across a clip (what run_alert does
    for video). Leave it None and each frame is scored against itself, which
    makes scores drift as the scene changes.
    """

    def __init__(
        self,
        reference: Optional[tuple[float, float]] = None,
        alert_at: float = 0.75,
        warn_at: float = 0.55,
        shrink: float = 0.2,
        pct: float = 80.0,
    ):
        if not 0.0 <= warn_at <= alert_at <= 1.0:
            raise ValueError("need 0 <= warn_at <= alert_at <= 1")
        self.reference = reference
        self.alert_at = alert_at
        self.warn_at = warn_at
        self.shrink = shrink
        self.pct = pct

    def level(self, proximity: float) -> str:
        if proximity >= self.alert_at:
            return "ALERT"
        if proximity >= self.warn_at:
            return "WARN"
        return "CLEAR"

    def score(self, depth: np.ndarray, detections: list[Detection]) -> list[ScoredDetection]:
        lo, hi = self.reference if self.reference is not None else frame_range(depth)
        span = (hi - lo) or 1e-8

        scored = []
        for det in detections:
            raw = box_depth(depth, det.box, self.shrink, self.pct)
            if not np.isfinite(raw):
                continue
            proximity = float(np.clip((raw - lo) / span, 0.0, 1.0))
            scored.append(ScoredDetection(
                label=det.label, kind=det.kind, confidence=det.confidence,
                box=det.box, depth_raw=raw, proximity=proximity,
                level=self.level(proximity), source=det.source,
            ))
        # Nearest first: the thing you would act on is at the top.
        scored.sort(key=lambda s: -s.proximity)
        return scored
