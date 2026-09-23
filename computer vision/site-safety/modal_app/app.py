"""Site safety: PPE compliance detection on Modal.

Runs a YOLOv12 checkpoint (classes: person, helmet, vest) over a video and
reports *who* is missing gear and for how long, rather than a raw box count.

    modal deploy modal_app/app.py
    modal run modal_app/app.py --video clip.mp4
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "detector"))

APP_NAME = "site-safety"
MODEL_DIR = "/models"
WEIGHTS = f"{MODEL_DIR}/yolov12m-builder.pt"

app = modal.App(APP_NAME)
model_volume = modal.Volume.from_name("site-safety-models", create_if_missing=True)

SMOKE = """python - <<'S'
import cv2, numpy as np, ultralytics, torch
print("smoke ok | ultralytics", ultralytics.__version__,
      "| torch", torch.__version__, "| cv2", cv2.__version__,
      "| numpy", np.__version__)
S"""

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0", "ffmpeg")
    .pip_install("ultralytics==8.4.160", "fastapi[standard]==0.141.1")
    .run_commands(SMOKE)   # fail the build, not the first request
    .env({"YOLO_CONFIG_DIR": "/tmp/ultralytics", "YOLO_VERBOSE": "False",
          "MPLCONFIGDIR": "/tmp/mpl"})
    .add_local_python_source("ppe", "inference")
)

# GPU is opt-in: it needs a payment method on the Modal account.
GPU_SPEC: Optional[str] = os.environ.get("SITE_SAFETY_GPU", "") or None
CPU_COUNT = float(os.environ.get("SITE_SAFETY_CPU", "8"))
MINUTES = 60


def _decode_image(payload: str):
    import cv2
    import numpy as np

    if not payload:
        raise ValueError("empty image payload")
    if payload.startswith("data:"):
        _, _, payload = payload.partition(",")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"not valid base64: {exc}") from exc
    frame = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("could not decode image (not a JPEG/PNG?)")
    return frame


@app.cls(
    image=image,
    gpu=GPU_SPEC,
    cpu=CPU_COUNT,
    volumes={MODEL_DIR: model_volume},
    scaledown_window=5 * MINUTES,
    timeout=60 * MINUTES,     # site footage can be long
)
class PPEDetector:
    @modal.enter()
    def load(self):
        import numpy as np

        from inference import PPEModel

        if not os.path.exists(WEIGHTS):
            raise FileNotFoundError(
                f"{WEIGHTS} missing from the volume. "
                "Run scripts/upload_model.py first."
            )
        self.model = PPEModel(WEIGHTS)
        self.model.predict([np.zeros((640, 640, 3), dtype=np.uint8)])  # warm
        print(f"loaded {WEIGHTS}; classes={self.model.names}")

    # -- single frame -------------------------------------------------------

    @modal.method()
    def analyze_image(self, image_b64: str, conf: float = 0.35) -> dict:
        from ppe import Config, associate

        frame = _decode_image(image_b64)
        cfg = Config(conf=conf)
        dets = self.model.predict([frame], conf=min(conf, cfg.person_conf))[0]
        people = associate(dets, frame.shape[0], cfg)
        return {
            "people": [
                {"box": [round(c, 1) for c in p.box], "conf": round(p.conf, 3),
                 "has_helmet": p.has_helmet, "has_vest": p.has_vest,
                 "compliant": p.compliant, "missing": p.missing}
                for p in people
            ],
            "raw_detections": [
                {"label": d.label, "box": [round(c, 1) for c in d.box],
                 "conf": round(d.conf, 3)} for d in dets
            ],
            "compliant": sum(1 for p in people if p.compliant),
            "violations": sum(1 for p in people if not p.compliant),
        }

    # -- whole video --------------------------------------------------------

    @modal.method()
    def process_video(
        self,
        video_bytes: bytes,
        stride: int = 3,
        conf: float = 0.35,
        batch: int = 16,
        max_snapshots: int = 8,
    ) -> dict:
        """Score a clip and return per-frame rows plus confirmed violations."""
        import tempfile

        import cv2

        from ppe import ComplianceMonitor, Config, associate

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fh:
            fh.write(video_bytes)
            path = fh.name

        cap = cv2.VideoCapture(path)
        if not cap.isOpened():
            os.unlink(path)
            raise ValueError("could not open video (unsupported container/codec?)")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))

        cfg = Config(conf=conf)
        monitor = ComplianceMonitor(cfg)
        timeline = []
        snapshots = {}
        t_start = time.perf_counter()

        pending, idx, read = [], 0, 0
        stride = max(1, stride)

        def flush():
            if not pending:
                return
            frames = [f for _, f in pending]
            preds = self.model.predict(frames, conf=min(conf, cfg.person_conf))
            for (fidx, frame), dets in zip(pending, preds):
                ts = fidx / fps
                people = associate(dets, h, cfg)
                rows = monitor.update(people, ts, fidx)
                timeline.append({
                    "t": round(ts, 3), "frame": fidx, "people": rows,
                    "n_people": len(rows),
                    "n_violating": sum(1 for r in rows if not r["compliant"]),
                    "n_flagged": sum(1 for r in rows if r["flagged"]),
                })
                # Keep a JPEG of any frame where something is newly flagged.
                if any(r["flagged"] for r in rows) and len(snapshots) < max_snapshots:
                    ok, buf = cv2.imencode(".jpg", frame,
                                           [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                    if ok:
                        snapshots[fidx] = base64.b64encode(buf).decode()
            pending.clear()

        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if read % stride == 0:
                    pending.append((read, frame))
                    if len(pending) >= batch:
                        flush()
                read += 1
            flush()
        finally:
            cap.release()
            os.unlink(path)

        summary = monitor.summary()
        scored = len(timeline)
        peak = max((r["n_people"] for r in timeline), default=0)
        frames_with_violation = sum(1 for r in timeline if r["n_flagged"] > 0)
        return {
            "video": {"width": w, "height": h, "fps": round(fps, 2),
                      "frames": read, "duration_s": round(read / fps, 2)},
            "scored_frames": scored,
            "stride": stride,
            "wall_s": round(time.perf_counter() - t_start, 1),
            "peak_people": peak,
            "frames_with_violation": frames_with_violation,
            "violation_frame_fraction": round(frames_with_violation / scored, 3)
            if scored else 0.0,
            **summary,
            "snapshots": snapshots,
            "timeline": timeline,
        }

    # -- HTTP ---------------------------------------------------------------

    @modal.fastapi_endpoint(method="POST", docs=True)
    def analyze(self, body: dict) -> dict:
        """POST {"image": "<base64 jpeg>", "conf": 0.35}"""
        from fastapi import HTTPException

        try:
            return self.analyze_image.local(
                body.get("image", ""), float(body.get("conf", 0.35))
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @modal.fastapi_endpoint(method="GET", docs=True)
    def health(self) -> dict:
        return {"ok": True, "classes": self.model.names,
                "gpu": GPU_SPEC or "cpu-only", "cpu": CPU_COUNT}


@app.local_entrypoint()
def main(video: str = "", image_path: str = "", stride: int = 3, conf: float = 0.35):
    import json
    import pathlib

    det = PPEDetector()

    if image_path:
        data = pathlib.Path(image_path).read_bytes()
        res = det.analyze_image.remote(base64.b64encode(data).decode(), conf)
        print(json.dumps({k: v for k, v in res.items() if k != "raw_detections"},
                         indent=2))
        return
    if not video:
        print("pass --video clip.mp4 or --image-path frame.jpg")
        return

    data = pathlib.Path(video).read_bytes()
    print(f"uploading {len(data)/1e6:.1f} MB, every {stride} frame(s)...")
    r = det.process_video.remote(data, stride, conf)
    v = r["video"]
    print(f"\n{v['width']}x{v['height']} @ {v['fps']}fps, {v['duration_s']}s")
    print(f"scored {r['scored_frames']} frames in {r['wall_s']}s")
    print(f"peak people in frame : {r['peak_people']}")
    print(f"people tracked       : {r['people_tracked']}")
    print(f"confirmed violations : {r['violations']}")
    for x in r["violation_list"]:
        print(f"  person #{x['track_id']}  t={x['start']:.1f}-{x['end']:.1f}s "
              f"({x['duration']:.1f}s)  missing: {', '.join(x['missing'])}")
