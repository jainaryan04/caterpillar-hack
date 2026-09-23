"""Which control does the operator mean? From a tap or a circle drawn on the picture.

Every picture Cat knows about (a paused video frame, a matched photo) comes
with the positions of the controls in it (0-1 coordinates). The operator
points by tapping or by drawing a rough circle around what they mean:

  - circle: the controls inside it, nearest to its middle first. A sloppy
    circle that misses slightly still counts for the control nearest to it.
  - tap: the control nearest to the tap.
  - neither: the control nearest the middle of the picture.

Pure geometry, microseconds; no image work.
"""

import math

import cv2
import numpy as np

CIRCLED = "circled by the operator"
TAPPED = "tapped by the operator"
CENTRE = "centre of the photo"
NEAR_CIRCLE = 1.5  # a control this many circle-radii from its middle still counts
MAX_CIRCLED = 4


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def pick(
    points: dict[str, tuple[float, float]],
    tap: tuple[float, float] | None = None,
    circle: list[tuple[float, float]] | None = None,
    default_centre: bool = True,
) -> tuple[list[str], str]:
    """(controls the operator means, how they showed it)."""
    if not points:
        return [], ""
    if circle and len(circle) >= 3:
        polygon = np.float32(circle).reshape(-1, 1, 2)
        middle = tuple(np.float32(circle).mean(axis=0))
        radius = max(_dist(middle, p) for p in circle)
        inside = [k for k, p in points.items() if cv2.pointPolygonTest(polygon, (float(p[0]), float(p[1])), False) >= 0]
        if inside:
            inside.sort(key=lambda k: _dist(points[k], middle))
            return inside[:MAX_CIRCLED], CIRCLED
        nearest = min(points, key=lambda k: _dist(points[k], middle))
        if _dist(points[nearest], middle) <= max(radius * NEAR_CIRCLE, 0.06):
            return [nearest], CIRCLED
        return [], "circled a spot with no known control"
    if tap:
        return [min(points, key=lambda k: _dist(points[k], tap))], TAPPED
    if default_centre:
        return [min(points, key=lambda k: _dist(points[k], (0.5, 0.5)))], CENTRE
    return [], ""
