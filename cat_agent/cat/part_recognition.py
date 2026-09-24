"""What kind of part did the operator circle? For photos Cat can't match to a known layout.

Photo matching (cat/photo_match.py) is exact but only works for layouts Cat has
a reference picture of. When a photo doesn't match (another machine, an angle
Cat hasn't seen), Cat still knows *where* the operator circled, and this
module says what the circled thing looks like: a joystick, a lever, a dial...

It uses SigLIP 2 (Google's open image-text model), run locally with ONNX on
the CPU through fastembed: free, no API call, ~0.2s per circle. It compares
two crops (tightly around the circle, and with the surroundings, which tell a
joystick on a console from a lever on the floor) against short descriptions
of each kind of part, and returns the top guesses with scores.

The descriptions' text embeddings are computed once and cached on disk
(data/manuals/part_labels.npz), so at runtime only the image model (~0.4GB)
is loaded.
"""

import hashlib
import json
import threading
import time
from dataclasses import dataclass
from functools import cache

import cv2
import numpy as np
from loguru import logger
from PIL import Image

from cat.rag.store import MANUALS_DIR

MODEL = "google/siglip2-base-patch16-224"
CACHE_PATH = MANUALS_DIR / "part_labels.npz"
TIGHT_WEIGHT = 0.75  # the circled crop counts most; the wider crop adds context
CONTEXT_PAD = 0.8  # the wider crop: the circle's box grown by 80% each way
TAP_BOX = 0.18  # a tap is treated as a circle this wide (share of the photo)


@dataclass(frozen=True)
class Part:
    name: str  # what Cat calls it
    prompts: tuple[str, ...]  # how it looks, for the image model
    callouts: tuple[str, ...] = ()  # 320D controls of this kind (cat/controls.py)
    manual: tuple[str, ...] = ()  # or manual sections, for things that aren't numbered controls


PARTS = (
    Part("joystick", ("a joystick handle with thumb buttons", "a tall black control stick with a rubber boot",
                      "an excavator joystick"), ("6",)),
    Part("travel levers and pedals", ("two long levers with foot pedals on the floor",
                                      "travel pedals and levers in front of a seat"), ("3",)),
    Part("short lever", ("a short lever with a coloured handle", "a small safety lever beside a seat"), ("2",)),
    Part("round dial", ("a large round knob that turns", "a rotary dial with speed markings",
                        "a big black round control knob"), ("7",)),
    Part("key switch", ("a keyhole ignition switch", "a key in an ignition switch"), ("8",)),
    Part("panel of push buttons", ("a panel of small round push buttons with icons",
                                   "a membrane keypad with symbol buttons"), ("9",)),
    Part("rocker switches", ("a row of rectangular rocker switches", "rocker switches in a panel"), ("9",)),
    Part("monitor screen", ("a small screen showing gauges", "a digital display screen",
                            "a monitor with a black screen in a frame"), ("5",)),
    Part("operator seat", ("a fabric operator seat cushion", "a seat"), ("10",)),
    Part("seat belt", ("a seat belt buckle", "a seat belt strap"), (), ("Operation Section > Seat Belt",)),
    Part("warning label", ("a yellow warning sticker with a triangle", "a warning label"), (),
         ("Safety Section > Safety Messages",)),
    Part("window", ("a window with trees outside", "glass window")),
    Part("floor", ("a dirty floor mat", "a floor")),
    Part("armrest", ("a padded armrest", "an armrest")),
)


@dataclass
class Guess:
    part: Part
    score: float  # 0-1, shares of the guesses


@dataclass
class Recognition:
    guesses: list[Guess]  # best first
    box: tuple[float, float, float, float]  # the circled area (0-1)
    ms: float

    @property
    def best(self) -> Guess:
        return self.guesses[0]


def _prompts_key() -> str:
    return hashlib.sha1(json.dumps([MODEL, [p.prompts for p in PARTS]]).encode()).hexdigest()[:12]


@cache
def _label_embeddings() -> np.ndarray:
    """One unit vector per part (the mean of its prompts), cached on disk."""
    key = _prompts_key()
    if CACHE_PATH.exists():
        cached = np.load(CACHE_PATH)
        if str(cached["key"]) == key:
            return cached["labels"]
    from fastembed import TextEmbedding

    logger.info("Part recognition: embedding the part descriptions (only when PARTS change)...")
    flat = [prompt for part in PARTS for prompt in part.prompts]
    try:
        vectors = np.array(list(TextEmbedding(MODEL).embed(flat)))
    except UnicodeDecodeError as e:  # fastembed reads the tokenizer file in the system codepage on Windows
        raise RuntimeError(
            "Rebuild the part labels in UTF-8 mode: set PYTHONUTF8=1, then run "
            "uv run python -c \"from cat import part_recognition as p; p.warm()\""
        ) from e
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    labels, i = [], 0
    for part in PARTS:
        mean = vectors[i : i + len(part.prompts)].mean(axis=0)
        labels.append(mean / np.linalg.norm(mean))
        i += len(part.prompts)
    labels = np.array(labels)
    np.savez(CACHE_PATH, key=key, labels=labels)
    return labels


_lock = threading.Lock()


@cache
def _image_model():
    from fastembed import ImageEmbedding

    return ImageEmbedding(MODEL)


def warm() -> None:
    """Load the model now (a few seconds; downloads it on the very first run)."""
    t0 = time.perf_counter()
    _label_embeddings()
    _image_model()
    logger.info(f"Part recognition ready ({time.perf_counter() - t0:.1f}s)")


def box_for(circle=None, tap=None) -> tuple[float, float, float, float] | None:
    if circle and len(circle) >= 3:
        xs, ys = [p[0] for p in circle], [p[1] for p in circle]
        return max(min(xs), 0.0), max(min(ys), 0.0), min(max(xs), 1.0), min(max(ys), 1.0)
    if tap:
        h = TAP_BOX / 2
        return max(tap[0] - h, 0.0), max(tap[1] - h, 0.0), min(tap[0] + h, 1.0), min(tap[1] + h, 1.0)
    return None


def _crop(image: np.ndarray, box, pad: float) -> Image.Image:
    h, w = image.shape[:2]
    x0, y0, x1, y1 = box
    bw, bh = max(x1 - x0, 0.02), max(y1 - y0, 0.02)
    x0, x1 = max(0.0, x0 - pad * bw), min(1.0, x1 + pad * bw)
    y0, y1 = max(0.0, y0 - pad * bh), min(1.0, y1 + pad * bh)
    crop = image[int(y0 * h) : max(int(y1 * h), int(y0 * h) + 2), int(x0 * w) : max(int(x1 * w), int(x0 * w) + 2)]
    return Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))


def recognize(image: np.ndarray, box) -> Recognition:
    """Top guesses for what's inside `box` of a BGR image. CPU-bound: run in a thread."""
    t0 = time.perf_counter()
    labels = _label_embeddings()
    with _lock:  # one ONNX session; keep calls from overlapping
        crops = list(_image_model().embed([_crop(image, box, 0.05), _crop(image, box, CONTEXT_PAD)]))
    vectors = np.array(crops)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    shares = np.exp(100 * (vectors @ labels.T))
    shares /= shares.sum(axis=1, keepdims=True)
    combined = TIGHT_WEIGHT * shares[0] + (1 - TIGHT_WEIGHT) * shares[1]
    order = np.argsort(-combined)[:3]
    guesses = [Guess(PARTS[i], float(combined[i])) for i in order]
    ms = 1000 * (time.perf_counter() - t0)
    logger.debug("part recognition: " + ", ".join(f"{g.part.name} {g.score:.0%}" for g in guesses) + f" in {ms:.0f}ms")
    return Recognition(guesses, tuple(box), ms)
