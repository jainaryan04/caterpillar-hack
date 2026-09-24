"""Which 320D controls are in the operator's photo? Classic computer vision, no AI model.

A vision LLM would cost money and ~2s per photo. The cab doesn't change, so
instead each photo is matched against reference pictures whose controls are
already known (where each numbered control is):

  1. SIFT keypoints on the photo (OpenCV, CPU) matched to each reference's
     precomputed keypoints (ratio test), then a RANSAC homography: the
     reference with the most geometric inliers is what the photo shows.
  2. The homography maps every known control position into the photo, so we
     know which controls are visible and where.
  3. The control the operator means: the one(s) they circled or tapped, else
     the one nearest the middle of the photo (cat/pointing.py).
  4. Each visible control's colour is sampled from the photo, so "the red
     button" can be resolved from text.

~100-200ms on a laptop CPU, $0 per photo, and it scales with CPU cores.

References: the manual's two control drawings (cab overview g03654245 and the
right side control panel g03666599, positions from video_build/callouts.json)
work for photos of the manual, the training videos or a screen. Real cab
photos are added as data/references/<name>.json, no code change:
    {"image": "right-console.jpg", "title": "Right console (photo)",
     "controls": {"13": [0.12, 0.40], "14": [0.18, 0.40], ...}}   # 0-1 positions
"""

import json
import time
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import cv2
import numpy as np
from loguru import logger

from cat.rag.images import IMAGES_DIR

ROOT = Path(__file__).resolve().parents[1]
CALLOUTS_PATH = ROOT / "video_build" / "callouts.json"
REFERENCES_DIR = ROOT / "data" / "references"

MAX_SIDE = 1000  # px; photos are scaled down to this before matching
RATIO = 0.75  # Lowe's ratio test
MIN_INLIERS = 40  # a true match has 100+; stray ones (a vest vs a drawing) ~20


@dataclass
class Reference:
    id: str
    title: str
    size: tuple[int, int]  # (w, h)
    controls: dict[str, tuple[float, float]]  # callout -> position (0-1)
    keypoints: np.ndarray  # (n, 2) positions in px
    descriptors: np.ndarray


@dataclass
class PhotoMatch:
    reference: str
    title: str
    inliers: int
    visible: dict[str, tuple[float, float]]  # callout -> position in the photo (0-1)
    colours: dict[str, str] = field(default_factory=dict)
    ms: float = 0.0
    # Which one the operator means (a tap or a circle) is worked out separately
    # (cat/pointing.py), so a new circle on the same photo needs no new matching.


def _gray(image: np.ndarray) -> np.ndarray:
    gray = image if image.ndim == 2 else cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = MAX_SIDE / max(h, w)
    if scale < 1:
        gray = cv2.resize(gray, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return gray


@cache
def _detector():
    return cv2.SIFT_create(nfeatures=3000)


def _features(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    keypoints, descriptors = _detector().detectAndCompute(gray, None)
    points = np.float32([k.pt for k in keypoints]) if keypoints else np.zeros((0, 2), np.float32)
    return points, descriptors


def _reference(ref_id: str, title: str, image: np.ndarray, controls: dict) -> Reference:
    gray = _gray(image)
    points, descriptors = _features(gray)
    return Reference(ref_id, title, (gray.shape[1], gray.shape[0]), controls, points, descriptors)


@cache
def references() -> list[Reference]:
    refs = []
    callouts = json.loads(CALLOUTS_PATH.read_text())
    titles = {"g03654245": "the manual's drawing of the cab (Operator Controls, page 95)",
              "g03666599": "the manual's drawing of the right side control panel (page 96)"}
    for drawing, entries in callouts.items():
        image = cv2.imread(str(IMAGES_DIR / f"{drawing}.png"))
        controls = {n: tuple(c["target"]) for n, c in entries.items()}
        refs.append(_reference(drawing, titles.get(drawing, drawing), image, controls))
    for path in sorted(REFERENCES_DIR.glob("*.json")):
        spec = json.loads(path.read_text(encoding="utf-8"))
        image = cv2.imread(str(path.with_name(spec["image"])))
        if image is None:  # reference photos aren't in git (see README)
            logger.debug(f"Reference {path.name}: no image {spec['image']}, skipped")
            continue
        refs.append(_reference(path.stem, spec.get("title", path.stem), image, {k: tuple(v) for k, v in spec["controls"].items()}))
    return refs


def warm() -> None:
    references()


def _colour(image: np.ndarray, x: float, y: float) -> str:
    """Dominant colour around a point, if it's clearly coloured."""
    h, w = image.shape[:2]
    cx, cy, r = int(x * w), int(y * h), max(4, int(0.015 * max(w, h)))
    patch = image[max(cy - r, 0) : cy + r, max(cx - r, 0) : cx + r]
    if patch.size == 0 or image.ndim == 2:
        return ""
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    coloured = hsv[(hsv[:, 1] > 110) & (hsv[:, 2] > 70)]
    if len(coloured) < 0.25 * len(hsv):
        return ""
    hue = float(np.median(coloured[:, 0]))  # OpenCV hue: 0-180
    for name, upper in (("red", 8), ("orange", 20), ("yellow", 34), ("green", 85), ("blue", 130), ("purple", 160), ("red", 181)):
        if hue < upper:
            return name
    return ""


def match_photo(data: bytes) -> PhotoMatch | None:
    """Match a photo (JPEG/PNG bytes) to the known control references. CPU-bound: run in a thread."""
    t0 = time.perf_counter()
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("not an image")
    gray = _gray(image)
    points, descriptors = _features(gray)
    if descriptors is None or len(points) < MIN_INLIERS:
        return None
    ph, pw = gray.shape

    matcher = cv2.BFMatcher(cv2.NORM_L2)
    best = None
    for ref in references():
        if ref.descriptors is None or len(ref.keypoints) < MIN_INLIERS:
            continue
        pairs = matcher.knnMatch(descriptors, ref.descriptors, k=2)
        good = [m for m, n in (p for p in pairs if len(p) == 2) if m.distance < RATIO * n.distance]
        if len(good) < MIN_INLIERS:
            continue
        src = points[[m.queryIdx for m in good]]
        dst = ref.keypoints[[m.trainIdx for m in good]]
        homography, mask = cv2.findHomography(src, dst, cv2.RANSAC, 6.0)
        if homography is None:
            continue
        inliers = int(mask.sum())
        if inliers >= MIN_INLIERS and (best is None or inliers > best[1]):
            best = (ref, inliers, homography)
    if best is None:
        return None

    ref, inliers, photo_to_ref = best
    try:
        ref_to_photo = np.linalg.inv(photo_to_ref)
    except np.linalg.LinAlgError:
        return None
    rw, rh = ref.size
    visible = {}
    for callout, (x, y) in ref.controls.items():
        px, py, pz = ref_to_photo @ np.array([x * rw, y * rh, 1.0])
        if pz <= 0:
            continue
        u, v = px / pz / pw, py / pz / ph
        if 0 <= u <= 1 and 0 <= v <= 1:
            visible[callout] = (round(u, 3), round(v, 3))
    if not visible:
        return None

    colours = {k: c for k, (x, y) in visible.items() if (c := _colour(image, x, y))}
    ms = 1000 * (time.perf_counter() - t0)
    logger.debug(f"photo: matched {ref.id} ({inliers} inliers), {len(visible)} controls in {ms:.0f}ms")
    return PhotoMatch(ref.id, ref.title, inliers, visible, colours, ms)
