"""How near is too near, and what to do about a single bad frame.

The detection and depth stack is shared with ../depth-estimation -- same
models, same proximity score. What a reversing camera adds is a decision:
one number per object becomes stop / slow / clear, and a verdict that does
not change on a single frame's flicker.

Proximity is relative (1.0 = the near end of what this camera sees), so the
thresholds are per-camera. Mount the camera, reverse toward a cone, read the
numbers off the JSON, set the bands. See the README.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

# Nearest band first: the first one an object clears is the band it is in.
DANGER, WARN, CLEAR = "DANGER", "WARN", "CLEAR"
RANK = {CLEAR: 0, WARN: 1, DANGER: 2}


@dataclass
class Bands:
    """Proximity cuts. `danger` must be nearer than `warn`."""

    danger: float = 0.75
    warn: float = 0.55

    def __post_init__(self):
        if not 0.0 <= self.warn <= self.danger <= 1.0:
            raise ValueError("need 0 <= warn <= danger <= 1")

    def band(self, proximity: float) -> str:
        if proximity >= self.danger:
            return DANGER
        if proximity >= self.warn:
            return WARN
        return CLEAR


def worst_band(objects: Iterable) -> str:
    """The most severe band among these objects, CLEAR when there are none."""
    return max((o.level for o in objects), key=lambda b: RANK.get(b, 0), default=CLEAR)


class Debounce:
    """Require a band to hold over several frames before the alert follows it.

    A reversing camera is the worst case for per-frame scoring: the detector
    drops a box for one frame and a DANGER alert blinks off while the obstacle
    is still there. So escalation is immediate -- getting *closer* is acted on
    at once -- while standing down needs `hold` consecutive calmer frames.

    Asymmetric on purpose. A late warning is dangerous; a warning that lingers
    a third of a second too long is not.
    """

    def __init__(self, hold: int = 3):
        if hold < 1:
            raise ValueError("hold must be >= 1")
        self.hold = hold
        self._recent: deque[str] = deque(maxlen=hold)
        self.level: str = CLEAR

    def update(self, observed: str) -> str:
        self._recent.append(observed)
        if RANK.get(observed, 0) > RANK.get(self.level, 0):
            self.level = observed          # escalate on sight
        elif len(self._recent) == self.hold and all(
            RANK.get(b, 0) < RANK.get(self.level, 0) for b in self._recent
        ):
            # Stand down only to the worst of the recent, calmer frames.
            self.level = max(self._recent, key=lambda b: RANK.get(b, 0))
        return self.level


class RearView:
    """Bands plus debounce: detections in, one verdict out."""

    def __init__(self, bands: Optional[Bands] = None, hold: int = 3):
        self.bands = bands or Bands()
        self.debounce = Debounce(hold)

    def assess(self, scored: Sequence) -> tuple[str, list]:
        """Re-band already-scored detections and return (verdict, objects).

        The shared ProximityScorer labels with its own two-level scheme; this
        overwrites `level` with the three-band one so downstream rendering and
        JSON agree with the verdict.
        """
        objects = list(scored)
        for o in objects:
            o.level = self.bands.band(o.proximity)
        objects.sort(key=lambda o: -o.proximity)
        return self.debounce.update(worst_band(objects)), objects
