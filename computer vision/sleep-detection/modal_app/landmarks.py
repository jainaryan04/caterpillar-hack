"""Turn MediaPipe FaceLandmarker output into the scalars the rules need.

MediaPipe gives 478 normalized landmarks per face. We only care about a
handful: the six points per eye that form the classic Eye Aspect Ratio, the
lip points that form a Mouth Aspect Ratio, and the 4x4 facial transformation
matrix that carries head pose.
"""

from __future__ import annotations

import math
from typing import Optional, Sequence

import numpy as np

# Canonical FaceMesh indices, in EAR order: [outer, upper1, upper2, inner, lower2, lower1]
RIGHT_EYE = (33, 160, 158, 133, 153, 144)
LEFT_EYE = (362, 385, 387, 263, 373, 380)

# Mouth: inner-lip vertical pairs measured against the mouth-corner span.
MOUTH_CORNERS = (61, 291)
MOUTH_VERTICAL_PAIRS = ((13, 14), (81, 178), (311, 402))

# Blendshape names emitted by face_landmarker.task with blendshapes enabled.
BLINK_SHAPES = ("eyeBlinkLeft", "eyeBlinkRight")
JAW_SHAPE = "jawOpen"


def to_pixel_array(landmarks: Sequence, width: int, height: int) -> np.ndarray:
    """Normalized landmarks -> (N, 2) pixel coords.

    Scaling by the actual crop size matters: normalized coordinates are
    relative to a possibly non-square crop, so using them directly would
    stretch one axis and corrupt every aspect ratio below.
    """
    return np.array(
        [(lm.x * width, lm.y * height) for lm in landmarks], dtype=np.float32
    )


def _dist(pts: np.ndarray, a: int, b: int) -> float:
    return float(np.linalg.norm(pts[a] - pts[b]))


def eye_aspect_ratio(pts: np.ndarray, idx: Sequence[int]) -> Optional[float]:
    """EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|). Open eye ~0.3, shut ~0.05."""
    p1, p2, p3, p4, p5, p6 = idx
    horizontal = _dist(pts, p1, p4)
    if horizontal < 1e-6:
        return None
    vertical = _dist(pts, p2, p6) + _dist(pts, p3, p5)
    return vertical / (2.0 * horizontal)


def mouth_aspect_ratio(pts: np.ndarray) -> Optional[float]:
    """Mean inner-lip opening over the mouth width. Closed ~0.03, yawn >0.6."""
    left, right = MOUTH_CORNERS
    width = _dist(pts, left, right)
    if width < 1e-6:
        return None
    verticals = [_dist(pts, a, b) for a, b in MOUTH_VERTICAL_PAIRS]
    return float(np.mean(verticals) / width)


def both_eyes_ear(pts: np.ndarray) -> Optional[float]:
    left = eye_aspect_ratio(pts, LEFT_EYE)
    right = eye_aspect_ratio(pts, RIGHT_EYE)
    vals = [v for v in (left, right) if v is not None]
    if not vals:
        return None
    return float(sum(vals) / len(vals))


def blendshape_lookup(blendshapes) -> dict:
    """Category list -> {name: score}. Empty dict if blendshapes are off."""
    if not blendshapes:
        return {}
    return {c.category_name: float(c.score) for c in blendshapes}


def blink_score(shapes: dict) -> Optional[float]:
    """Max of the two eyeBlink blendshapes: one shut eye is enough to notice."""
    vals = [shapes[k] for k in BLINK_SHAPES if k in shapes]
    return max(vals) if vals else None


def jaw_open_score(shapes: dict) -> Optional[float]:
    return shapes.get(JAW_SHAPE)


def head_pose_deg(matrix) -> tuple:
    """4x4 facial transformation matrix -> (pitch, yaw, roll) in degrees.

    Pitch is negated so that "chin toward chest" reads negative, matching the
    nod rule in rules.py.
    """
    if matrix is None:
        return (None, None, None)
    m = np.asarray(matrix, dtype=np.float64)
    if m.shape != (4, 4):
        return (None, None, None)
    r = m[:3, :3].copy()
    # Strip any scale the solver folded into the matrix before decomposing.
    for c in range(3):
        norm = np.linalg.norm(r[:, c])
        if norm > 1e-9:
            r[:, c] /= norm
    sy = math.hypot(r[0, 0], r[1, 0])
    if sy < 1e-6:  # gimbal lock
        pitch = math.atan2(-r[1, 2], r[1, 1])
        yaw = math.atan2(-r[2, 0], sy)
        roll = 0.0
    else:
        pitch = math.atan2(r[2, 1], r[2, 2])
        yaw = math.atan2(-r[2, 0], sy)
        roll = math.atan2(r[1, 0], r[0, 0])
    return (-math.degrees(pitch), math.degrees(yaw), math.degrees(roll))
