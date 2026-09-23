"""YOLO wrapper: frames in, PPE Detections out.

Kept separate from the Modal entrypoint so the same code runs locally and in
the container.
"""

from __future__ import annotations

from typing import List, Optional

from ppe import Detection


class PPEModel:
    def __init__(self, weights: str, imgsz: int = 640, device: Optional[str] = None):
        from ultralytics import YOLO

        self.model = YOLO(weights)
        self.imgsz = imgsz
        self.device = device
        self.names = self.model.names
        expected = {"person", "helmet", "vest"}
        got = set(self.names.values())
        if not expected.issubset(got):
            raise ValueError(
                f"checkpoint classes {sorted(got)} do not include {sorted(expected)}"
            )

    def predict(self, frames: List, conf: float = 0.25) -> List[List[Detection]]:
        """Run a batch. Batching keeps the CPU busy between frames."""
        kw = {"imgsz": self.imgsz, "conf": conf, "verbose": False}
        if self.device:
            kw["device"] = self.device
        results = self.model.predict(frames, **kw)
        out = []
        for r in results:
            dets = []
            boxes = r.boxes
            if boxes is not None:
                for b in boxes:
                    x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
                    dets.append(Detection(
                        label=self.names[int(b.cls[0])],
                        box=(x1, y1, x2, y2),
                        conf=float(b.conf[0]),
                    ))
            out.append(dets)
        return out
