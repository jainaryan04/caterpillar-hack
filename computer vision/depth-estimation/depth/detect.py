"""Object detection for the proximity alert.

Depth Anything V2 is a dense regression model: one float per pixel, no
semantics. It cannot tell a worker from the ground they stand on, so the
"what" has to come from a detector and the "how far" from depth.

Two detector backends:

  coco  (default)  yolo11m, the 80-class COCO model. Solid on person and road
                   vehicles. Has *no* heavy-machinery class -- see README.
  world            YOLO-World, open-vocabulary: takes class names as text.
                   Reaches machinery that COCO cannot name, at low confidence.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

HERE = pathlib.Path(__file__).resolve().parents[1]

# COCO names we care about, grouped into the two things the alert reasons about.
PEOPLE = ("person",)
VEHICLES = ("bicycle", "car", "motorcycle", "bus", "train", "truck", "boat")

# Starting prompt set for the open-vocabulary backend. "construction machine"
# is the one that actually lands on an excavator; the specific names mostly
# do not. Tune per site.
WORLD_PROMPTS = (
    "person",
    "truck",
    "car",
    "construction machine",
    "excavator",
    "bulldozer",
    "wheel loader",
    "tractor",
    "crane",
)


@dataclass
class Detection:
    """One detected object, before depth is attached."""

    label: str
    confidence: float
    box: tuple[int, int, int, int]      # x1, y1, x2, y2
    kind: str                            # "person" | "vehicle"
    source: str = "coco"                 # which detector found it

    @property
    def width(self) -> int:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]


def classify(label: str) -> Optional[str]:
    """COCO/prompt label -> the group the alert reasons about, or None to drop."""
    low = label.lower()
    if low in PEOPLE:
        return "person"
    if low in VEHICLES:
        return "vehicle"
    # Everything the open-vocabulary prompts add is machinery, i.e. a vehicle
    # for alerting purposes.
    if any(w in low for w in
           ("machine", "excavat", "dozer", "loader", "tractor", "crane",
            "digger", "forklift", "roller", "dumper")):
        return "vehicle"
    return None


class Detector:
    """YOLO wrapper that only ever returns people and vehicles."""

    def __init__(
        self,
        backend: str = "coco",
        weights: Optional[str] = None,
        conf: float = 0.25,
        imgsz: int = 960,
        prompts: Sequence[str] = WORLD_PROMPTS,
        device: Optional[str] = None,
    ):
        from ultralytics import YOLO

        if backend not in ("coco", "world"):
            raise ValueError("backend must be 'coco' or 'world'")

        default = "yolo11m.pt" if backend == "coco" else "yolov8s-worldv2.pt"
        path = pathlib.Path(weights) if weights else HERE / "models" / default

        self.backend = backend
        self.conf = conf
        self.imgsz = imgsz
        self.device = device
        self.model = YOLO(str(path))
        self.prompts = list(prompts)
        if backend == "world":
            self.model.set_classes(self.prompts)
        self.names = self.prompts if backend == "world" else self.model.names

    def _effective_imgsz(self, bgr: np.ndarray) -> int:
        """Never upscale past the source resolution.

        Feeding a 347x280 thumbnail in at imgsz 960 costs real detections: the
        car in the sample becomes a "stop sign" and nothing else. Capping at
        the longest side (rounded up to the stride, floored at 320) finds it
        again, and leaves big frames untouched.
        """
        longest = max(bgr.shape[:2])
        if longest >= self.imgsz:
            return self.imgsz
        return max(320, int(np.ceil(longest / 32.0)) * 32)

    def detect(self, bgr: np.ndarray) -> list[Detection]:
        kwargs = dict(conf=self.conf, imgsz=self._effective_imgsz(bgr), verbose=False)
        if self.device:
            kwargs["device"] = self.device
        result = self.model.predict(bgr, **kwargs)[0]

        out = []
        for box in result.boxes:
            idx = int(box.cls)
            label = self.names[idx] if isinstance(self.names, list) else self.names[idx]
            kind = classify(label)
            if kind is None:
                continue
            x1, y1, x2, y2 = (int(round(v)) for v in box.xyxy[0].tolist())
            out.append(Detection(label=label, confidence=float(box.conf),
                                 box=(x1, y1, x2, y2), kind=kind))
        return out
