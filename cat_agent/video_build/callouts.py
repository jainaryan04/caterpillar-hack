"""Find where each numbered control is in the manual's overview drawings (run once, offline).

The callout numbers ("15", "1a") are drawn inside the raster pictures, not as
PDF text, so:
  1. local OCR (rapidocr, CPU) finds each number's box;
  2. OpenCV finds straight line segments (HoughLinesP); the leader line is the
     longest one that starts at the number, and its far end is the control.
The result goes to video_build/callouts.json, with an overlay PNG per drawing in
data/videos/_callouts/ to check by eye. Entries can be corrected by hand in the
JSON ("fixed": true keeps them on re-runs).

    uv run --group video video_build/callouts.py
"""

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "data" / "manuals" / "images"
OUT = Path(__file__).with_name("callouts.json")
OVERLAYS = ROOT / "data" / "videos" / "_callouts"

# Overview drawings whose legend numbers the controls (see cat/rag/parse.py).
DRAWINGS = {
    "g03654245": [*"1a 1b 2 3 4 5 6 7 8 9 10 11 12".split()],  # cab, left side
    "g03666599": [*"1a 13 14 15 16 17 18 19 20 21 22 23 24 25 26".split()],  # right console switches
}
MAX_START_GAP = 14  # px between a number's box and the start of its leader line


def _gap(box: tuple[float, float, float, float], x: float, y: float) -> float:
    x0, y0, x1, y1 = box
    dx = max(x0 - x, 0, x - x1)
    dy = max(y0 - y, 0, y - y1)
    return math.hypot(dx, dy)


def find_callouts(image_path: Path, wanted: list[str], ocr) -> dict[str, dict]:
    gray = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    result = ocr(str(image_path))
    labels = {}
    for quad, text, score in zip(result.boxes, result.txts, result.scores):
        text = text.strip().lower()
        if text in wanted and score > 0.8 and text not in labels:
            xs, ys = [p[0] for p in quad], [p[1] for p in quad]
            labels[text] = tuple(float(v) for v in (min(xs), min(ys), max(xs), max(ys)))

    # Blank the numbers so their strokes don't count as lines.
    ink = (gray < 128).astype(np.uint8) * 255
    for x0, y0, x1, y1 in labels.values():
        ink[int(y0) - 1 : int(y1) + 2, int(x0) - 1 : int(x1) + 2] = 0
    segments = cv2.HoughLinesP(ink, 1, np.pi / 360, threshold=25, minLineLength=18, maxLineGap=3)
    segments = [] if segments is None else segments.reshape(-1, 4).tolist()

    found = {}
    h, w = gray.shape
    for name, box in labels.items():
        best = None
        for x1, y1, x2, y2 in segments:
            for (sx, sy), (ex, ey) in (((x1, y1), (x2, y2)), ((x2, y2), (x1, y1))):
                if _gap(box, sx, sy) > MAX_START_GAP:
                    continue
                length = math.hypot(ex - sx, ey - sy)
                if best is None or length > best[0]:
                    best = (length, ex, ey)
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        tx, ty = (best[1], best[2]) if best else (cx, cy)
        found[name] = {
            "label": [round(v / d, 4) for v, d in zip(box, (w, h, w, h))],
            "target": [round(tx / w, 4), round(ty / h, 4)],
            "traced": best is not None,
        }
    return found


def draw_overlay(image_path: Path, callouts: dict[str, dict], out: Path) -> None:
    img = cv2.imread(str(image_path))
    h, w = img.shape[:2]
    for name, c in callouts.items():
        x0, y0, x1, y1 = (int(v * d) for v, d in zip(c["label"], (w, h, w, h)))
        tx, ty = int(c["target"][0] * w), int(c["target"][1] * h)
        cv2.rectangle(img, (x0, y0), (x1, y1), (0, 160, 255), 2)
        cv2.circle(img, (tx, ty), 14, (0, 0, 255) if c.get("fixed") else (0, 200, 0), 3)
        cv2.putText(img, name, (tx + 16, ty + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 0, 200), 2)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img)


def main():
    from rapidocr import RapidOCR

    ocr = RapidOCR()
    existing = json.loads(OUT.read_text()) if OUT.exists() else {}
    data = {}
    for gid, wanted in DRAWINGS.items():
        path = IMAGES / f"{gid}.png"
        found = find_callouts(path, wanted, ocr)
        for name, old in existing.get(gid, {}).items():
            if old.get("fixed"):
                found[name] = old  # hand-corrected: keep
        missing = [n for n in wanted if n not in found]
        data[gid] = dict(sorted(found.items(), key=lambda kv: wanted.index(kv[0])))
        draw_overlay(path, data[gid], OVERLAYS / f"{gid}.png")
        untraced = [n for n, c in found.items() if not c["traced"]]
        print(f"{gid}: {len(found)}/{len(wanted)} callouts; missing {missing or '-'}; no leader line {untraced or '-'}")
    OUT.write_text(json.dumps(data, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}; overlays in {OVERLAYS.relative_to(ROOT)}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
