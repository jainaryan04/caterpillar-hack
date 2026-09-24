"""Pictures that show the operator what Cat understood.

  - their photo with their circle (or tap) and a label on each control Cat
    thinks they mean: "15 Travel Alarm Cancel Switch";
  - the same control in the manual: the manual's drawing zoomed onto it, with
    a ring and its number, so they can compare their photo with the manual.

Both are small JPEGs in data/screen/ served at /screen-images/ (cat/server.py).
OpenCV on the CPU, a few ms each; manual close-ups are cached.
"""

import time
from pathlib import Path

import cv2
import numpy as np

from cat.controls import catalogue
from cat.rag.images import IMAGES_DIR

SCREEN_DIR = Path(__file__).resolve().parents[1] / "data" / "screen"
SCREEN_URL_PREFIX = "/screen-images/"
YELLOW = (17, 205, 255)  # BGR: Cat yellow
BLACK = (20, 20, 20)
MAX_SIDE = 1280
CLOSEUP_SIZE = 420


def _label(img: np.ndarray, text: str, x: int, y: int, scale: float) -> None:
    font, thick = cv2.FONT_HERSHEY_SIMPLEX, max(1, int(2 * scale))
    (w, h), base = cv2.getTextSize(text, font, 0.7 * scale, thick)
    x = min(max(x, 4), img.shape[1] - w - 12)
    y = min(max(y, h + 12), img.shape[0] - 8)
    cv2.rectangle(img, (x - 6, y - h - 8), (x + w + 6, y + base + 2), YELLOW, -1)
    cv2.putText(img, text, (x, y), font, 0.7 * scale, BLACK, thick, cv2.LINE_AA)


def annotate_photo(
    data: bytes, visible: dict, meant: list[str], tap=None, circle=None, session_id: str = "local", note: str | None = None
) -> str:
    """Draw the operator's mark and Cat's reading on their photo. Returns its URL."""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    h, w = img.shape[:2]
    s = max(w, h) / 1000  # line and text size

    def px(p):
        return int(p[0] * w), int(p[1] * h)

    # Faint numbers on every control Cat found, so the operator sees what it knows.
    for callout, pos in visible.items():
        if callout not in meant:
            cv2.circle(img, px(pos), int(9 * s), YELLOW, max(1, int(2 * s)), cv2.LINE_AA)
    if circle and len(circle) >= 2:
        pts = np.int32([px(p) for p in circle]).reshape(-1, 1, 2)
        cv2.polylines(img, [pts], True, BLACK, int(7 * s), cv2.LINE_AA)
        cv2.polylines(img, [pts], True, YELLOW, int(4 * s), cv2.LINE_AA)
    if tap:
        cv2.drawMarker(img, px(tap), YELLOW, cv2.MARKER_CROSS, int(26 * s), int(3 * s))
    controls = catalogue()
    for callout in meant:
        x, y = px(visible[callout])
        cv2.circle(img, (x, y), int(24 * s), BLACK, int(6 * s), cv2.LINE_AA)
        cv2.circle(img, (x, y), int(24 * s), YELLOW, int(3 * s), cv2.LINE_AA)
        name = controls[callout].name if callout in controls else ""
        _label(img, f"{callout} {name}", x + int(28 * s), y - int(28 * s), s)

    if note and (circle or tap):
        # What Cat thinks the marked part is, when it had no known layout to match.
        anchor = circle if circle else [tap]
        x = int(min(p[0] for p in anchor) * w)
        y = int(min(p[1] for p in anchor) * h) - int(10 * s)
        _label(img, note, x, y, s)

    SCREEN_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_")[:40] or "local"
    path = SCREEN_DIR / f"photo-{safe}.jpg"
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 82])
    return f"{SCREEN_URL_PREFIX}{path.name}?v={int(time.time() * 1000)}"  # new URL each time: no stale cache


def manual_closeup(callout: str) -> str | None:
    """The manual's drawing zoomed onto one numbered control, ringed. Returns its URL (cached)."""
    control = catalogue().get(callout)
    if control is None:
        return None
    path = SCREEN_DIR / f"manual-{callout}.jpg"
    if not path.exists():
        drawing = cv2.imread(str(IMAGES_DIR / f"{control.drawing}.png"))
        if drawing is None:
            return None
        h, w = drawing.shape[:2]
        cx, cy = int(control.target[0] * w), int(control.target[1] * h)
        half = int(0.16 * max(w, h))
        pad = cv2.copyMakeBorder(drawing, half, half, half, half, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        crop = pad[cy : cy + 2 * half, cx : cx + 2 * half]
        crop = cv2.resize(crop, (CLOSEUP_SIZE, CLOSEUP_SIZE), interpolation=cv2.INTER_CUBIC)
        c = CLOSEUP_SIZE // 2
        cv2.circle(crop, (c, c), 40, BLACK, 7, cv2.LINE_AA)
        cv2.circle(crop, (c, c), 40, YELLOW, 4, cv2.LINE_AA)
        _label(crop, f"{callout} {control.name}", 10, CLOSEUP_SIZE - 14, 0.75)
        _label(crop, f"Manual page {control.page}", 10, 30, 0.75)
        SCREEN_DIR.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(path), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return f"{SCREEN_URL_PREFIX}{path.name}"
