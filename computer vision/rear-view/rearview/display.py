"""Rear-view rendering: heatmap, boxes, and an alert you cannot miss.

The shared overlay in ../depth-estimation draws a two-level (ALERT/CLEAR)
safety view. A reversing display wants three bands and a verdict that reads
from across a cab, so the drawing lives here.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np

from zones import CLEAR, DANGER, WARN

COLORS = {                       # BGR
    DANGER: (60, 60, 255),
    WARN: (60, 190, 250),
    CLEAR: (120, 220, 120),
}
MESSAGES = {
    DANGER: "STOP - OBJECT CLOSE",
    WARN: "CAUTION",
    CLEAR: "CLEAR",
}


def draw_objects(canvas: np.ndarray, objects: Sequence, dx: int = 0) -> np.ndarray:
    import cv2

    out = canvas.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    base = max(1, int(round(scale * 3)))

    for o in objects:
        x1, y1, x2, y2 = o.box
        x1, x2 = x1 + dx, x2 + dx
        color = COLORS.get(o.level, COLORS[CLEAR])
        # The thing about to be hit is drawn heaviest.
        weight = base + (2 if o.level == DANGER else 0)
        cv2.rectangle(out, (x1, y1), (x2, y2), color, weight)
        mark = "*" if getattr(o, "source", "coco") == "remote" else ""
        tag = f"{mark}{o.label} {o.proximity:.2f}"
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, scale * 0.85, base)
        ty = max(0, y1 - th - 4)
        cv2.rectangle(out, (x1, ty), (min(x1 + tw + 6, w), ty + th + 6), color, -1)
        cv2.putText(out, tag, (x1 + 3, ty + th + 1), cv2.FONT_HERSHEY_SIMPLEX,
                    scale * 0.85, (20, 20, 20), base, cv2.LINE_AA)
    return out


def draw_verdict(canvas: np.ndarray, verdict: str, objects: Sequence,
                 extra: str = "") -> np.ndarray:
    """Banner, plus a full border at DANGER so it reads peripherally."""
    import cv2

    out = canvas.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    color = COLORS.get(verdict, COLORS[CLEAR])

    if verdict == DANGER:
        thickness = max(6, int(18 * scale))
        cv2.rectangle(out, (0, 0), (w - 1, h - 1), color, thickness)

    bar = int(62 * scale * 1.6)
    panel = out.copy()
    cv2.rectangle(panel, (0, 0), (w, bar), (18, 18, 18), -1)
    cv2.addWeighted(panel, 0.78, out, 0.22, 0, out)

    cv2.putText(out, MESSAGES.get(verdict, verdict), (14, int(bar * 0.62)),
                cv2.FONT_HERSHEY_SIMPLEX, scale * 1.25, color,
                max(2, int(round(scale * 3))), cv2.LINE_AA)

    nearest = objects[0] if objects else None
    detail = f"{len(objects)} tracked"
    if nearest is not None:
        detail += f"   nearest {nearest.label} {nearest.proximity:.2f}"
    if extra:
        detail += f"   {extra}"
    cv2.putText(out, detail, (14, int(bar * 0.92)), cv2.FONT_HERSHEY_SIMPLEX,
                scale * 0.7, (215, 215, 215), max(1, int(round(scale * 1.6))),
                cv2.LINE_AA)
    return out


def compose(frame: np.ndarray, heat: np.ndarray, view: str) -> np.ndarray:
    import cv2

    if view == "heatmap":
        return heat
    if view == "frame":
        return frame
    gap = np.full((frame.shape[0], max(8, frame.shape[1] // 80), 3), 255, np.uint8)
    return cv2.hconcat([frame, gap, heat])
