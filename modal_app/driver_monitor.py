"""Driver-facing camera: eye state, yawning and head pose via MediaPipe Face Landmarker.

We return raw per-frame signals only. All temporal reasoning (PERCLOS, microsleep,
sustained head-drop) happens client-side in client/fatigue.py, because fatigue is a
multi-second state and the state machine must survive dropped frames.
"""

import os
import urllib.request

import modal

from .common import WEIGHTS_DIR, app, cpu_image, weights_volume

LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
LANDMARKER_PATH = os.path.join(WEIGHTS_DIR, "face_landmarker.task")

# MediaPipe FaceMesh indices: (corner, upper1, upper2, corner, lower2, lower1)
LEFT_EYE = (362, 385, 387, 263, 373, 380)
RIGHT_EYE = (33, 160, 158, 133, 153, 144)
MOUTH = (13, 14, 78, 308)  # upper inner, lower inner, left corner, right corner

BLENDSHAPES_OF_INTEREST = (
    "eyeBlinkLeft", "eyeBlinkRight", "jawOpen",
    "eyeLookDownLeft", "eyeLookDownRight",
    "eyeSquintLeft", "eyeSquintRight",
    "browDownLeft", "browDownRight",
)


@app.cls(
    image=cpu_image,
    cpu=2.0,
    volumes={WEIGHTS_DIR: weights_volume},
    scaledown_window=300,
    min_containers=1,
    timeout=60,
)
@modal.concurrent(max_inputs=8)
class DriverMonitor:
    @modal.enter()
    def load(self):
        import mediapipe as mp

        if not os.path.exists(LANDMARKER_PATH):
            os.makedirs(WEIGHTS_DIR, exist_ok=True)
            urllib.request.urlretrieve(LANDMARKER_URL, LANDMARKER_PATH)
            weights_volume.commit()

        base_options = mp.tasks.BaseOptions(model_asset_path=LANDMARKER_PATH)
        options = mp.tasks.vision.FaceLandmarkerOptions(
            base_options=base_options,
            running_mode=mp.tasks.vision.RunningMode.IMAGE,
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            min_face_detection_confidence=0.4,
            min_face_presence_confidence=0.4,
        )
        self.landmarker = mp.tasks.vision.FaceLandmarker.create_from_options(options)
        self.mp = mp

    @staticmethod
    def _aspect_ratio(pts, idx):
        """Classic eye/mouth aspect ratio: vertical opening over horizontal width."""
        import numpy as np

        p = [np.array([pts[i].x, pts[i].y]) for i in idx]
        if len(idx) == 6:
            vertical = np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])
            horizontal = 2.0 * np.linalg.norm(p[0] - p[3])
        else:
            vertical = 2.0 * np.linalg.norm(p[0] - p[1])
            horizontal = 2.0 * np.linalg.norm(p[2] - p[3])
        return float(vertical / horizontal) if horizontal > 1e-6 else 0.0

    @staticmethod
    def _euler_from_matrix(matrix):
        """Yaw/pitch/roll in degrees from the 4x4 facial transformation matrix."""
        import math

        import numpy as np

        m = np.array(matrix).reshape(4, 4)[:3, :3]
        sy = math.sqrt(m[0, 0] ** 2 + m[1, 0] ** 2)
        if sy > 1e-6:
            pitch = math.atan2(-m[2, 0], sy)
            yaw = math.atan2(m[1, 0], m[0, 0])
            roll = math.atan2(m[2, 1], m[2, 2])
        else:  # gimbal lock
            pitch = math.atan2(-m[2, 0], sy)
            yaw = 0.0
            roll = math.atan2(-m[1, 2], m[1, 1])
        return {
            "yaw_deg": round(math.degrees(yaw), 1),
            "pitch_deg": round(math.degrees(pitch), 1),
            "roll_deg": round(math.degrees(roll), 1),
        }

    @modal.method()
    def analyse(self, frame_jpeg: bytes) -> dict:
        import time

        import numpy as np

        from .common import decode_jpeg

        t0 = time.perf_counter()
        frame = decode_jpeg(frame_jpeg)
        rgb = frame[:, :, ::-1].copy()
        mp_image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=rgb)

        result = self.landmarker.detect(mp_image)
        elapsed = round((time.perf_counter() - t0) * 1000, 1)

        if not result.face_landmarks:
            return {
                "face_found": False,
                "operator_present": False,
                "latency_ms": elapsed,
            }

        pts = result.face_landmarks[0]
        ear_left = self._aspect_ratio(pts, LEFT_EYE)
        ear_right = self._aspect_ratio(pts, RIGHT_EYE)
        mar = self._aspect_ratio(pts, MOUTH)

        blend = {}
        if result.face_blendshapes:
            for cat in result.face_blendshapes[0]:
                if cat.category_name in BLENDSHAPES_OF_INTEREST:
                    blend[cat.category_name] = round(float(cat.score), 4)

        pose = {"yaw_deg": 0.0, "pitch_deg": 0.0, "roll_deg": 0.0}
        if result.facial_transformation_matrixes:
            pose = self._euler_from_matrix(result.facial_transformation_matrixes[0])

        # Two independent eye-closure estimates; the state machine fuses them so a
        # failure of either one degrades gracefully instead of silently going quiet.
        blink_score = max(
            blend.get("eyeBlinkLeft", 0.0), blend.get("eyeBlinkRight", 0.0)
        )
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]

        return {
            "face_found": True,
            "operator_present": True,
            "ear": round((ear_left + ear_right) / 2.0, 4),
            "ear_left": round(ear_left, 4),
            "ear_right": round(ear_right, 4),
            "mar": round(mar, 4),
            "blink_score": round(float(blink_score), 4),
            "blendshapes": blend,
            "head_pose": pose,
            "face_bbox_norm": [
                round(float(np.min(xs)), 4), round(float(np.min(ys)), 4),
                round(float(np.max(xs)), 4), round(float(np.max(ys)), 4),
            ],
            "latency_ms": elapsed,
        }
