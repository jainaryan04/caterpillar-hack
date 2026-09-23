"""Face landmarking for the sleep detector.

MediaPipe FaceLandmarker does detection and landmarking in one pass. There is
no separate face detector: measured on the sample clips, MediaPipe's built-in
BlazeFace matched a YOLOv12-face checkpoint frame-for-frame at webcam distance
(100% on tired_driver) while running ~28x faster -- 8 ms against 230 ms.
"""

from __future__ import annotations

import time
from typing import Optional

import numpy as np

import landmarks as lmk
from rules import FrameSignals


class FacePipeline:
    """Frame in, facial measurements out. Holds no temporal state."""

    def __init__(self, landmarker_path: str, min_confidence: float = 0.4):
        """The CPU delegate is pinned deliberately.

        MediaPipe otherwise picks a GPU delegate when it believes one exists,
        which aborts the process on macOS (DrishtiMetalHelper: "Service is
        unavailable"). Landmarking is a few milliseconds on CPU regardless.
        """
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        self._mp = mp
        self.landmarker = mp_vision.FaceLandmarker.create_from_options(
            mp_vision.FaceLandmarkerOptions(
                base_options=mp_python.BaseOptions(
                    model_asset_path=landmarker_path,
                    delegate=mp_python.BaseOptions.Delegate.CPU,
                ),
                running_mode=mp_vision.RunningMode.IMAGE,
                num_faces=1,
                min_face_detection_confidence=min_confidence,
                min_face_presence_confidence=min_confidence,
                min_tracking_confidence=min_confidence,
                output_face_blendshapes=True,
                output_facial_transformation_matrixes=True,
            )
        )

    def measure(self, frame, timestamp: float) -> dict:
        """BGR frame -> raw facial signals."""
        import cv2

        t0 = time.perf_counter()
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_img = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(mp_img)
        elapsed = {"landmark": round((time.perf_counter() - t0) * 1000.0, 1)}

        if not result.face_landmarks:
            return {
                "signals": FrameSignals(timestamp=timestamp, face_found=False),
                "box": None,
                "landmarks": None,
                "head_pose": {"pitch": None, "yaw": None, "roll": None},
                "timing_ms": elapsed,
            }

        face = result.face_landmarks[0]
        h, w = frame.shape[:2]
        pts = lmk.to_pixel_array(face, w, h)

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
            face_confidence=1.0,
        )

        # No detector box to report, so derive one from the landmark extent.
        # It is what the HUD draws, and it tracks the face just as well.
        x1, y1 = pts.min(axis=0)
        x2, y2 = pts.max(axis=0)

        def project(indices):
            return [[round(float(pts[i][0]), 1), round(float(pts[i][1]), 1)]
                    for i in indices]

        return {
            "signals": sig,
            "box": [round(float(x1), 1), round(float(y1), 1),
                    round(float(x2), 1), round(float(y2), 1), 1.0],
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
            "timing_ms": elapsed,
        }
