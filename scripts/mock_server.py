"""Local stand-in for the Modal endpoints.

Serves the exact same contract so the client's HTTP plumbing - query params, raw JPEG
bodies, JSON shapes - is proven before any GPU is involved. Responses are synthetic.
"""

import base64
import json
import math
import random
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import cv2
import numpy as np

START = time.time()


def depth_png(w=320, h=180):
    rows = np.linspace(0.0, 1.0, h).reshape(-1, 1)
    depth = np.tile(1.0 - rows, (1, w))
    cv2.circle(depth, (int(w * 0.6), int(h * 0.7)), 20, 0.9, -1)
    ok, buf = cv2.imencode(".png", (np.clip(depth, 0, 1) * 255).astype(np.uint8))
    return base64.b64encode(buf.tobytes()).decode("ascii")


def moving_scene():
    """A worker walking steadily toward the machine, so TTC has something to chew on."""
    t = time.time() - START
    approaching = max(1.4, 22.0 - t * 1.6)
    return {
        "detections": [
            {"label": "person", "is_person": True, "conf": 0.9, "track_id": 1,
             "bbox_norm": [0.44, 0.42, 0.54, 0.80],
             "distance_m": round(approaching, 2),
             "lateral_m": round(math.sin(t / 3.0) * 1.2, 2)},
            {"label": "person", "is_person": True, "conf": 0.8, "track_id": 2,
             "bbox_norm": [0.70, 0.44, 0.77, 0.68],
             "distance_m": 9.4, "lateral_m": 3.1},
            {"label": "truck", "is_person": False, "conf": 0.85, "track_id": 5,
             "bbox_norm": [0.05, 0.36, 0.26, 0.72],
             "distance_m": 17.2, "lateral_m": -5.8},
        ],
        "obstacles": [
            {"distance_m": 4.2, "lateral_m": 1.4, "height_m": 1.1, "area_px": 800,
             "bbox_norm": [0.52, 0.58, 0.70, 0.84]},
        ],
        "depth_png_b64": depth_png(),
        "depth_preview_size": [320, 180],
        "frame_size": [1280, 720],
        "timing_ms": {"detect": 17.0, "depth": 44.0, "total": 66.0},
    }


def driver_signal():
    """Alert for 6s, then a sustained closure so the fatigue chain trips on camera."""
    t = time.time() - START
    closed = (t % 14.0) > 8.0
    return {
        "face_found": True, "operator_present": True,
        "ear": 0.08 if closed else 0.30 + random.uniform(-0.02, 0.02),
        "ear_left": 0.08 if closed else 0.30, "ear_right": 0.08 if closed else 0.30,
        "mar": 0.5 if closed else 0.07,
        "blink_score": 0.94 if closed else 0.05,
        "blendshapes": {"eyeBlinkLeft": 0.94 if closed else 0.05,
                        "eyeBlinkRight": 0.92 if closed else 0.05,
                        "jawOpen": 0.58 if closed else 0.05},
        "head_pose": {"yaw_deg": round(math.sin(t / 4) * 12, 1),
                      "pitch_deg": -19.0 if closed else -3.0, "roll_deg": 0.5},
        "face_bbox_norm": [0.34, 0.21, 0.66, 0.75],
        "latency_ms": 19.0,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, payload, code=200):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/health"):
            return self._send({"status": "ok", "mock": True, "ts": time.time()})
        if self.path.startswith("/incidents"):
            return self._send({"incidents": []})
        self._send({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        if self.path.startswith("/front"):
            assert body[:2] == b"\xff\xd8", "client did not send a JPEG body"
            return self._send(moving_scene())
        if self.path.startswith("/driver"):
            assert body[:2] == b"\xff\xd8", "client did not send a JPEG body"
            return self._send(driver_signal())
        if self.path.startswith("/incident"):
            return self._send({"logged": True, "id": "mock"})
        self._send({"error": "not found"}, 404)


if __name__ == "__main__":
    print("mock endpoints on http://127.0.0.1:8777")
    HTTPServer(("127.0.0.1", 8777), Handler).serve_forever()
