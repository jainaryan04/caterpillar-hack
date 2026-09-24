"""Rendering: depth heatmap, person boxes, alert banner."""

from __future__ import annotations

from typing import Sequence

import numpy as np

LEVEL_COLORS = {                 # BGR
    "ALERT": (60, 60, 255),
    "CLEAR": (120, 220, 120),
}


def heatmap(depth: np.ndarray, cmap: str = "Spectral_r") -> np.ndarray:
    """Depth map -> BGR heatmap. Red is near, blue is far."""
    import matplotlib

    lo, hi = float(depth.min()), float(depth.max())
    t = (depth - lo) / (hi - lo + 1e-8)
    rgb = matplotlib.colormaps.get_cmap(cmap)(t)
    return np.ascontiguousarray((rgb[..., :3] * 255).astype(np.uint8)[..., ::-1])


def draw_people(canvas: np.ndarray, people: Sequence, dx: int = 0) -> np.ndarray:
    """Boxes coloured by level, labelled with the proximity score."""
    import cv2

    out = canvas.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    thick = max(1, int(round(scale * 3)))

    for p in people:
        x1, y1, x2, y2 = p.box
        x1, x2 = x1 + dx, x2 + dx
        color = LEVEL_COLORS.get(p.level, LEVEL_COLORS["CLEAR"])
        # Equipment-model boxes are drawn heavier, so you can see at a glance
        # which detector is carrying which object.
        weight = thick + 1 if p.source == "remote" else thick
        cv2.rectangle(out, (x1, y1), (x2, y2), color, weight)
        mark = "*" if p.source == "remote" else ""
        tag = f"{mark}{p.label} {p.proximity:.2f}"
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, scale * 0.85, thick)
        ty = max(0, y1 - th - 4)
        cv2.rectangle(out, (x1, ty), (min(x1 + tw + 6, w), ty + th + 6), color, -1)
        cv2.putText(out, tag, (x1 + 3, ty + th + 1), cv2.FONT_HERSHEY_SIMPLEX,
                    scale * 0.85, (20, 20, 20), thick, cv2.LINE_AA)
    return out


def draw_banner(canvas: np.ndarray, people: Sequence, extra: str = "") -> np.ndarray:
    import cv2

    out = canvas.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    bar = int(46 * scale * 1.6)

    worst = "ALERT" if any(p.level == "ALERT" for p in people) else "CLEAR"
    bits = [worst, f"{len(people)} tracked"]
    if people:
        bits.append(f"nearest {people[0].proximity:.2f}")
    if extra:
        bits.append(extra)

    o = out.copy()
    cv2.rectangle(o, (0, 0), (w, bar), (24, 24, 24), -1)
    cv2.addWeighted(o, 0.72, out, 0.28, 0, out)
    cv2.putText(out, "  |  ".join(bits), (12, int(bar * 0.68)),
                cv2.FONT_HERSHEY_SIMPLEX, scale * 0.85, LEVEL_COLORS.get(worst, LEVEL_COLORS["CLEAR"]),
                max(1, int(round(scale * 2))), cv2.LINE_AA)
    return out


def compose(frame: np.ndarray, heat: np.ndarray, view: str) -> np.ndarray:
    """view: heatmap | frame | split (camera beside heatmap)."""
    import cv2

    if view == "heatmap":
        return heat
    if view == "frame":
        return frame
    gap = np.full((frame.shape[0], max(8, frame.shape[1] // 80), 3), 255, np.uint8)
    return cv2.hconcat([frame, gap, heat])
