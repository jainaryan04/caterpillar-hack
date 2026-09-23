"""Render the HUD against mocked service responses.

Proves the whole client path - fatigue state machine, proximity rules, radar geometry,
compositor - without needing Modal deployed. Writes out/hud_preview.png.
"""

import base64
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from client.fatigue import FatigueMonitor
from client.render import compose
from client.safety_rules import ProximityMonitor


def fake_depth_png(w=320, h=180):
    """Ground plane receding to the horizon with a near obstacle blob."""
    rows = np.linspace(0.0, 1.0, h).reshape(-1, 1)
    depth = np.tile(1.0 - rows, (1, w))            # near = bright at bottom
    cv2.circle(depth, (int(w * 0.62), int(h * 0.72)), 22, 0.92, -1)
    u8 = (np.clip(depth, 0, 1) * 255).astype(np.uint8)
    ok, buf = cv2.imencode(".png", u8)
    assert ok
    return base64.b64encode(buf.tobytes()).decode("ascii")


def fake_perception():
    return {
        "detections": [],  # proximity monitor reads tracks it builds itself
        "obstacles": [
            {"distance_m": 2.4, "lateral_m": 1.1, "height_m": 1.2, "area_px": 900,
             "bbox_norm": [0.55, 0.60, 0.72, 0.85]},
            {"distance_m": 11.8, "lateral_m": -1.9, "height_m": 0.8, "area_px": 300,
             "bbox_norm": [0.22, 0.52, 0.31, 0.63]},
        ],
        "depth_png_b64": fake_depth_png(),
        "depth_preview_size": [320, 180],
        "frame_size": [1280, 720],
        "timing_ms": {"detect": 18.2, "depth": 47.5, "total": 71.0},
    }


def perception_with_people():
    data = fake_perception()
    data["detections"] = [
        {"label": "person", "is_person": True, "conf": 0.91, "track_id": 3,
         "bbox_norm": [0.42, 0.44, 0.52, 0.80], "distance_m": 2.6, "lateral_m": -0.4},
        {"label": "person", "is_person": True, "conf": 0.86, "track_id": 7,
         "bbox_norm": [0.68, 0.40, 0.75, 0.66], "distance_m": 6.1, "lateral_m": 2.2},
        {"label": "truck", "is_person": False, "conf": 0.79, "track_id": 11,
         "bbox_norm": [0.06, 0.34, 0.27, 0.70], "distance_m": 14.3, "lateral_m": -5.4},
        {"label": "person", "is_person": True, "conf": 0.72, "track_id": 12,
         "bbox_norm": [0.80, 0.42, 0.86, 0.60], "distance_m": 19.7, "lateral_m": 6.8},
    ]
    return data


def drowsy_signal(closed: bool):
    return {
        "face_found": True,
        "operator_present": True,
        "ear": 0.09 if closed else 0.31,
        "ear_left": 0.09 if closed else 0.31,
        "ear_right": 0.09 if closed else 0.31,
        "mar": 0.55 if closed else 0.08,
        "blink_score": 0.93 if closed else 0.04,
        "blendshapes": {
            "eyeBlinkLeft": 0.93 if closed else 0.04,
            "eyeBlinkRight": 0.91 if closed else 0.05,
            "jawOpen": 0.62 if closed else 0.05,
        },
        "head_pose": {"yaw_deg": -6.0, "pitch_deg": -21.0 if closed else -2.0, "roll_deg": 1.0},
        "face_bbox_norm": [0.33, 0.20, 0.67, 0.74],
        "latency_ms": 22.4,
    }


def main():
    os.makedirs("out", exist_ok=True)

    cap = cv2.VideoCapture("media/front_workers.mp4")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 120)
    ok, front_frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit("run scripts/fetch_demo_media.py first")

    cap = cv2.VideoCapture("media/site_builders.mp4")
    ok2, driver_frame = cap.read()
    cap.release()
    driver_frame = driver_frame if ok2 else front_frame.copy()

    # Drive a synthetic clock so seconds of history pass in milliseconds.
    clock = {"t": 0.0}
    def now():
        return clock["t"]

    fatigue_monitor = FatigueMonitor(now=now)
    proximity_monitor = ProximityMonitor(now=now)

    perception = perception_with_people()
    fatigue = proximity = None

    # 5s awake to calibrate the personalised EAR baseline, then 3s of eyes closed.
    for step in range(160):
        clock["t"] += 0.05
        closed = step > 100
        fatigue = fatigue_monitor.update(drowsy_signal(closed))
        proximity = proximity_monitor.update(perception)

    print(f"fatigue   level={fatigue.level} score={fatigue.score} "
          f"perclos={fatigue.perclos:.0%} calibrated={fatigue.calibrated}")
    print(f"           alerts={fatigue.alerts}")
    print(f"proximity zone={proximity.zone} people_in_danger={proximity.people_in_danger} "
          f"nearest={proximity.nearest_person_m}m")
    print(f"           alerts={proximity.alerts}")
    print(f"           tracks={len(proximity.tracks)}")

    hud = compose(
        driver_frame, front_frame, perception, proximity, fatigue,
        stats={
            "driver_signal": drowsy_signal(True),
            "render_fps": 29.4, "front_ms": 71.0, "driver_ms": 22.4, "incidents": 2,
        },
        size=(1600, 940),
    )
    cv2.imwrite("out/hud_preview.png", hud)
    print(f"\nwrote out/hud_preview.png  {hud.shape[1]}x{hud.shape[0]}")

    # Second frame: all-clear, to check the calm state renders too.
    calm = fake_perception()
    calm["detections"] = [
        {"label": "person", "is_person": True, "conf": 0.88, "track_id": 3,
         "bbox_norm": [0.42, 0.44, 0.50, 0.72], "distance_m": 18.4, "lateral_m": -1.2},
    ]
    calm["obstacles"] = []
    calm_monitor = ProximityMonitor(now=now)
    calm_prox = calm_monitor.update(calm)
    calm_fatigue = FatigueMonitor(now=now).update(drowsy_signal(False))
    hud2 = compose(
        driver_frame, front_frame, calm, calm_prox, calm_fatigue,
        stats={"driver_signal": drowsy_signal(False), "render_fps": 30.0,
               "front_ms": 68.0, "driver_ms": 21.0, "incidents": 0},
        size=(1600, 940),
    )
    cv2.imwrite("out/hud_allclear.png", hud2)
    print(f"wrote out/hud_allclear.png  zone={calm_prox.zone} level={calm_fatigue.level}")


if __name__ == "__main__":
    main()
