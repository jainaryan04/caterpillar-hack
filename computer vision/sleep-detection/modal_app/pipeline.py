"""Face detection + landmarking, independent of Modal.

This is the exact code path the Modal container runs, factored out so it can
also run locally (scripts/run_local.py). Keeping one implementation means what
you validate on your laptop is what deploys.
"""

from __future__ import annotations

import os
import time
from typing import Optional

import landmarks as lmk
from rules import FrameSignals


class FacePipeline:
    """Detect the driver's face, landmark it, return per-frame signals."""

    def __init__(
        self,
        landmarker_path: str,
        yolo_path: Optional[str] = None,
        detector: str = "auto",
        yolo_conf: float = 0.35,
        crop_margin: float = 0.25,
        warmup: bool = True,
    ):
        """The landmarker is pinned to the CPU delegate on purpose.

        MediaPipe's default picks a GPU delegate when it thinks one is there,
        which aborts the process on macOS (DrishtiMetalHelper: "Service is
        unavailable"). The landmarker is only a few ms on CPU anyway -- the
        GPU on Modal is there for YOLO, not for this.
        """
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        self.yolo_conf = yolo_conf
        self.crop_margin = crop_margin
        self.detector_mode = detector
        self._mp = mp

        # --- face detector ---
        # "mediapipe" skips YOLO entirely and lets FaceLandmarker use its own
        # built-in BlazeFace detector on the full frame. For a webcam-distance
        # frontal face that is both more reliable and ~25x faster; YOLO earns
        # its keep on small, distant or awkwardly-angled faces.
        self.yolo = None
        self.yolo_error = None
        if detector == "mediapipe":
            self.yolo_error = "disabled (detector='mediapipe')"
        elif yolo_path and os.path.exists(yolo_path):
            try:
                from ultralytics import YOLO

                self.yolo = YOLO(yolo_path)
                if warmup:
                    import numpy as np

                    self.yolo.predict(
                        np.zeros((480, 640, 3), dtype=np.uint8), verbose=False
                    )
            except Exception as exc:  # noqa: BLE001 - degrade, don't die
                self.yolo_error = f"{type(exc).__name__}: {exc}"
                self.yolo = None
                if detector == "yolo":
                    raise
        else:
            self.yolo_error = f"checkpoint not found: {yolo_path}"
            if detector == "yolo":
                raise FileNotFoundError(self.yolo_error)

        # --- landmarker ---
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(
            mp_vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=landmarker_path,
                    delegate=mp_python.BaseOptions.Delegate.CPU,
                ),
                running_mode=mp_vision.RunningMode.IMAGE,
                num_faces=1,
                min_face_detection_confidence=0.4,
                min_face_presence_confidence=0.4,
                min_tracking_confidence=0.4,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
            )
        )

    @property
    def detector_name(self) -> str:
        if self.yolo is not None:
            return "yolo"
        # Distinguish a deliberate choice from YOLO having failed to load.
        return "mediapipe" if self.detector_mode == "mediapipe" else "mediapipe-fallback"

    # -- detection ---------------------------------------------------------

    def _detect_face(self, frame):
        """Largest face above threshold, or None.

        In a cab the driver is nearest the camera, so the largest box is the
        one that should drive the alarm -- not a passenger's face.
        """
        if self.yolo is None:
            return None
        res = self.yolo.predict(frame, conf=self.yolo_conf, verbose=False)
        if not res:
            return None
        boxes = res[0].boxes
        if boxes is None or len(boxes) == 0:
            return None
        best, best_area = None, -1.0
        for b in boxes:
            x1, y1, x2, y2 = (float(v) for v in b.xyxy[0].tolist())
            area = max(0.0, x2 - x1) * max(0.0, y2 - y1)
            if area > best_area:
                best_area, best = area, (x1, y1, x2, y2, float(b.conf[0]))
        return best

    def _crop(self, frame, box):
        h, w = frame.shape[:2]
        x1, y1, x2, y2, _ = box
        mx = (x2 - x1) * self.crop_margin
        my = (y2 - y1) * self.crop_margin
        cx1, cy1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
        cx2, cy2 = min(w, int(x2 + mx)), min(h, int(y2 + my))
        if cx2 - cx1 < 20 or cy2 - cy1 < 20:
            return None, (0, 0)
        return frame[cy1:cy2, cx1:cx2], (cx1, cy1)

    # -- main ---------------------------------------------------------------

    def measure(self, frame, timestamp: float) -> dict:
        """BGR frame -> raw facial signals. Holds no temporal state."""
        import cv2

        t0 = time.perf_counter()
        box = self._detect_face(frame)
        t_det = (time.perf_counter() - t0) * 1000.0

        # No box: landmark the whole frame. A coarse read beats no read when
        # the detector blinks for a frame.
        if box is None:
            crop, offset, box_out = frame, (0, 0), None
        else:
            crop, offset = self._crop(frame, box)
            if crop is None:
                crop, offset = frame, (0, 0)
            box_out = [round(v, 1) for v in box[:4]] + [round(box[4], 3)]

        t1 = time.perf_counter()
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        mp_img = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(mp_img)
        t_lm = (time.perf_counter() - t1) * 1000.0
        timing = {"detect": round(t_det, 1), "landmark": round(t_lm, 1)}

        if not result.face_landmarks:
            return {
                "signals": FrameSignals(timestamp=timestamp, face_found=False),
                "box": box_out,
                "landmarks": None,
                "head_pose": {"pitch": None, "yaw": None, "roll": None},
                "timing_ms": timing,
            }

        face = result.face_landmarks[0]
        ch, cw = crop.shape[:2]
        pts = lmk.to_pixel_array(face, cw, ch)

        shapes = lmk.blendshape_lookup(
            result.face_blendshapes[0] if result.face_blendshapes else None
        )
        matrix = (
            result.facial_transformation_matrixes[0]
            if result.facial_transformation_matrixes
            else None
        )
        pitch, yaw, roll = lmk.head_pose_deg(matrix)

        sig = FrameSignals(
            timestamp=timestamp,
            face_found=True,
            ear=lmk.both_eyes_ear(pts),
            mar=lmk.mouth_aspect_ratio(pts),
            blink_score=lmk.blink_score(shapes),
            jaw_open_score=lmk.jaw_open_score(shapes),
            pitch_deg=pitch,
            yaw_deg=yaw,
            roll_deg=roll,
            face_confidence=float(box[4]) if box else 0.0,
        )

        ox, oy = offset

        def project(indices):
            return [
                [round(float(pts[i][0] + ox), 1), round(float(pts[i][1] + oy), 1)]
                for i in indices
            ]

        return {
            "signals": sig,
            "box": box_out,
            "landmarks": {
                "left_eye": project(lmk.LEFT_EYE),
                "right_eye": project(lmk.RIGHT_EYE),
                "mouth": project(
                    lmk.MOUTH_CORNERS
                    + tuple(i for p in lmk.MOUTH_VERTICAL_PAIRS for i in p)
                ),
            },
            "head_pose": {
                "pitch": round(pitch, 1) if pitch is not None else None,
                "yaw": round(yaw, 1) if yaw is not None else None,
                "roll": round(roll, 1) if roll is not None else None,
            },
            "timing_ms": timing,
        }
