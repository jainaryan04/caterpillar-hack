"""Driver sleep detection on Modal.

Pipeline per frame:

    frame -> YOLO face detector (yolov12m-face.pt)  -> pick the driver's face
          -> crop + margin
          -> MediaPipe FaceLandmarker (478 pts + blendshapes + head pose)
          -> EAR / MAR / blink / jawOpen / pitch
          -> DrowsinessMonitor (temporal rules)     -> ALERT..CRITICAL

YOLO does the detection because it is far more robust than MediaPipe's own
face detector on a dashcam-angle, poorly lit, partially occluded driver.
MediaPipe then does the landmarking on a tight crop, which is where it is
strongest.

The CV itself lives in pipeline.py so the same code runs locally
(scripts/run_local.py) and in the container.

Deploy:   modal deploy modal_app/app.py
Try it:   modal run modal_app/app.py --video samples/tired_driver_720p.mp4
"""

from __future__ import annotations

import base64
import binascii
import os
import sys
import time
from pathlib import Path
from typing import Optional

import modal

# Make the sibling modules importable as top-level modules no matter which
# directory `modal run` / `modal deploy` was invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# --------------------------------------------------------------------------
# App / image
# --------------------------------------------------------------------------

APP_NAME = "sleep-detection"
MODEL_DIR = "/models"
YOLO_FACE_PATH = f"{MODEL_DIR}/yolov12m-face.pt"
LANDMARKER_PATH = "/opt/face_landmarker.task"
LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)

app = modal.App(APP_NAME)

# Weights live in a Volume so the 40 MB checkpoint is not baked into (and
# re-pushed with) every image rebuild. Populate it with scripts/upload_model.py.
model_volume = modal.Volume.from_name("sleep-detection-models", create_if_missing=True)

# mediapipe wants opencv-contrib-python, ultralytics wants opencv-python. Both
# ship a `cv2` package, so we let pip install what each asks for and keep the
# apt GL/GLib libs around, since the resulting cv2 is not the headless build.
SMOKE_TEST = """python - <<'SMOKE'
import cv2, numpy as np, mediapipe as mp, ultralytics
from mediapipe.tasks import python as mpp
from mediapipe.tasks.python import vision as mpv

lm = mpv.FaceLandmarker.create_from_options(
    mpv.FaceLandmarkerOptions(
        base_options=mpp.BaseOptions(model_asset_path="%s"),
        running_mode=mpv.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
)
img = mp.Image(image_format=mp.ImageFormat.SRGB,
               data=np.zeros((256, 256, 3), dtype=np.uint8))
res = lm.detect(img)
assert hasattr(res, "face_landmarks")
assert hasattr(res, "face_blendshapes")
assert hasattr(res, "facial_transformation_matrixes")
print("smoke ok | mediapipe", mp.__version__,
      "| ultralytics", ultralytics.__version__,
      "| cv2", cv2.__version__, "| numpy", np.__version__)
SMOKE""" % LANDMARKER_PATH

image = (
    modal.Image.debian_slim(python_version="3.11")
    # libgles2 + libegl1 are required by mediapipe's C bindings
    # (libGLESv2.so.2); libgl1/libglib2.0-0 by cv2.
    .apt_install(
        "libgl1", "libglib2.0-0", "libgles2", "libegl1", "ffmpeg", "curl"
    )
    .pip_install(
        "ultralytics==8.4.160",
        "mediapipe==0.10.35",   # 1.0.x aborts on macOS, so this keeps local == container
        "fastapi[standard]==0.141.1",
    )
    .run_commands(
        f"curl -fsSL -o {LANDMARKER_PATH} {LANDMARKER_URL}",
        # Fail the build, not the first request, if any of this drifts.
        SMOKE_TEST,
    )
    .env(
        {
            # Keep ultralytics from phoning home or writing to a read-only HOME.
            "YOLO_CONFIG_DIR": "/tmp/ultralytics",
            "YOLO_VERBOSE": "False",
            "MPLCONFIGDIR": "/tmp/mpl",
        }
    )
    .add_local_python_source("rules", "landmarks", "pipeline")
)

# GPU is optional and off by default: YOLO on a 640px frame is small enough
# to run on CPU, and a GPU requires a payment method on the Modal account.
# Set SLEEP_DETECTION_GPU=T4 (or A10G, L4...) to turn one on.
GPU_SPEC: Optional[str] = os.environ.get("SLEEP_DETECTION_GPU", "") or None
# Face detection is the bottleneck on CPU, and it threads well.
CPU_COUNT: float = float(os.environ.get("SLEEP_DETECTION_CPU", "4"))
MINUTES = 60


def _decode_image(payload: str):
    """base64 (optionally a data: URL) -> BGR ndarray."""
    import cv2
    import numpy as np

    if not payload:
        raise ValueError("empty image payload")
    if payload.startswith("data:"):
        _, _, payload = payload.partition(",")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"image is not valid base64: {exc}") from exc
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("could not decode image bytes (not a JPEG/PNG?)")
    return frame


# --------------------------------------------------------------------------
# The detector
# --------------------------------------------------------------------------


@app.cls(
    image=image,
    gpu=GPU_SPEC,
    cpu=CPU_COUNT,
    volumes={MODEL_DIR: model_volume},
    scaledown_window=5 * MINUTES,
    timeout=10 * MINUTES,
    # Session state (blink history, PERCLOS window) lives in container memory,
    # so every frame of a session must reach the same container. One container
    # with in-container concurrency keeps that true and is plenty for a demo.
    max_containers=1,
)
@modal.concurrent(max_inputs=8)
class SleepDetector:
    @modal.enter()
    def load(self):
        from pipeline import FacePipeline

        self._sessions = {}
        self._session_seen = {}
        self.pipeline = FacePipeline(
            landmarker_path=LANDMARKER_PATH,
            yolo_path=YOLO_FACE_PATH,
        )
        print(f"detector: {self.pipeline.detector_name}")
        if self.pipeline.yolo_error:
            print(f"yolo note: {self.pipeline.yolo_error}")

    def _monitor(self, session_id: str, reset: bool = False):
        from rules import DrowsinessMonitor

        now = time.time()
        # Drop sessions nobody has touched in 15 minutes so a long-lived
        # container does not accumulate state forever.
        for sid, seen in list(self._session_seen.items()):
            if now - seen > 15 * MINUTES:
                self._sessions.pop(sid, None)
                self._session_seen.pop(sid, None)

        mon = self._sessions.get(session_id)
        if mon is None or reset:
            mon = DrowsinessMonitor()
            self._sessions[session_id] = mon
        self._session_seen[session_id] = now
        return mon

    # -- callable methods --------------------------------------------------

    @modal.method()
    def analyze_frame(
        self,
        image_b64: str,
        session_id: str = "default",
        timestamp: Optional[float] = None,
        reset: bool = False,
    ) -> dict:
        frame = _decode_image(image_b64)
        ts = timestamp if timestamp is not None else time.time()
        out = self.pipeline.measure(frame, ts)
        verdict = self._monitor(session_id, reset).update(out["signals"])
        return {
            "verdict": verdict.to_dict(),
            "box": out["box"],
            "landmarks": out.get("landmarks"),
            "head_pose": out.get("head_pose"),
            "timing_ms": out["timing_ms"],
            "detector": self.pipeline.detector_name,
        }

    @modal.method()
    def process_video(self, video_bytes: bytes, stride: int = 1) -> dict:
        """Run a whole clip server-side and return a per-frame timeline."""
        import tempfile

        import cv2

        from rules import DrowsinessMonitor

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fh:
            fh.write(video_bytes)
            path = fh.name

        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            os.unlink(path)
            raise ValueError("could not open video (unsupported container/codec?)")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

        monitor = DrowsinessMonitor()
        timeline, events = [], []
        idx, prev_level = 0, None
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if idx % max(1, stride) == 0:
                    ts = idx / fps
                    out = self.pipeline.measure(frame, ts)
                    v = monitor.update(out["signals"])
                    timeline.append(
                        {
                            "t": round(ts, 3),
                            "frame": idx,
                            "level": v.level,
                            "score": v.score,
                            "ear": v.ear,
                            "mar": v.mar,
                            "perclos": v.perclos,
                            "closure_s": v.closure_s,
                            "pitch": v.pitch_deg,
                            "face": v.face_found,
                        }
                    )
                    if v.level != prev_level:
                        events.append(
                            {"t": round(ts, 3), "level": v.level, "reasons": v.reasons}
                        )
                        prev_level = v.level
                idx += 1
        finally:
            cap.release()
            os.unlink(path)

        drowsy = [p for p in timeline if p["level"] in ("DROWSY", "CRITICAL")]
        return {
            "frames_read": idx,
            "frames_scored": len(timeline),
            "fps": round(fps, 2),
            "duration_s": round(idx / fps, 2) if fps else None,
            "drowsy_fraction": round(len(drowsy) / len(timeline), 3) if timeline else 0.0,
            "peak_score": max((p["score"] for p in timeline), default=0.0),
            "detector": self.pipeline.detector_name,
            "transitions": events,
            "timeline": timeline,
        }

    # -- HTTP endpoints ----------------------------------------------------

    @modal.fastapi_endpoint(method="POST", docs=True)
    def analyze(self, body: dict) -> dict:
        """POST {"image": "<base64 jpeg>", "session_id": "...", "timestamp": 123.4}"""
        from fastapi import HTTPException

        try:
            frame = _decode_image(body.get("image", ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        ts = body.get("timestamp")
        ts = float(ts) if ts is not None else time.time()
        session_id = str(body.get("session_id", "default"))
        out = self.pipeline.measure(frame, ts)
        verdict = self._monitor(session_id, bool(body.get("reset"))).update(
            out["signals"]
        )
        return {
            "verdict": verdict.to_dict(),
            "box": out["box"],
            "landmarks": out.get("landmarks") if body.get("want_landmarks", True) else None,
            "head_pose": out.get("head_pose"),
            "timing_ms": out["timing_ms"],
        }

    @modal.fastapi_endpoint(method="POST", docs=True)
    def measure_only(self, body: dict) -> dict:
        """Stateless variant: raw signals only, client runs the rules."""
        from dataclasses import asdict

        from fastapi import HTTPException

        try:
            frame = _decode_image(body.get("image", ""))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        ts = body.get("timestamp")
        ts = float(ts) if ts is not None else time.time()
        out = self.pipeline.measure(frame, ts)
        return {
            "signals": asdict(out["signals"]),
            "box": out["box"],
            "landmarks": out.get("landmarks"),
            "head_pose": out.get("head_pose"),
            "timing_ms": out["timing_ms"],
        }

    @modal.fastapi_endpoint(method="GET", docs=True)
    def health(self) -> dict:
        return {
            "ok": True,
            "detector": self.pipeline.detector_name,
            "yolo_error": self.pipeline.yolo_error,
            "gpu": GPU_SPEC or "cpu-only",
            "cpu": CPU_COUNT,
            "active_sessions": len(self._sessions),
        }


# --------------------------------------------------------------------------
# Local entrypoint
# --------------------------------------------------------------------------


@app.local_entrypoint()
def main(video: str = "", image_path: str = "", stride: int = 1):
    """modal run modal_app/app.py --video clip.mp4  |  --image-path face.jpg"""
    import json
    import pathlib

    det = SleepDetector()

    if image_path:
        data = pathlib.Path(image_path).read_bytes()
        res = det.analyze_frame.remote(base64.b64encode(data).decode(), "cli")
        print(json.dumps(res["verdict"], indent=2))
        return

    if not video:
        print("pass --video clip.mp4 or --image-path face.jpg")
        return

    data = pathlib.Path(video).read_bytes()
    print(f"uploading {len(data)/1e6:.1f} MB and scoring every {stride} frame(s)...")
    res = det.process_video.remote(data, stride)
    print(
        f"\n{res['frames_scored']} frames scored over {res['duration_s']}s "
        f"@ {res['fps']} fps   (detector: {res['detector']})"
    )
    print(f"drowsy fraction: {res['drowsy_fraction']:.1%}   peak score: {res['peak_score']}")
    print("\nstate changes:")
    for e in res["transitions"]:
        print(f"  t={e['t']:>7.2f}s  {e['level']:<9} {', '.join(e['reasons'])}")
