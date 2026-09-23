"""Live webcam driver-sleep monitor.

    python scripts/run_webcam.py
    python scripts/run_webcam.py --record demo.mp4

Everything runs on this machine at around 110 fps. Capture and display happen
on the main thread while a worker thread does inference, so the preview never
stutters even if a frame takes longer than usual.
"""

from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys
import threading
import time
from queue import Empty, Queue

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "detector"))

def rescale(result, factor):
    """Map box/landmark coords from the sent frame back to the display frame.

    Without this the overlay lands at the wrong place and scale whenever the
    frame is downscaled before sending, which looks exactly like the detector
    failing even when it is working perfectly.
    """
    if factor == 1.0 or not result:
        return result
    box = result.get("box")
    if box:
        result["box"] = [c * factor for c in box[:4]] + [box[4]]
    lm = result.get("landmarks")
    if lm:
        result["landmarks"] = {
            k: [[x * factor, y * factor] for x, y in pts] for k, pts in lm.items()
        }
    return result


LEVEL_COLORS = {          # BGR
    "ALERT": (90, 200, 90),
    "MILD": (60, 200, 250),
    "DROWSY": (40, 120, 255),
    "CRITICAL": (60, 60, 255),
    "UNKNOWN": (160, 160, 160),
}


# --------------------------------------------------------------------------
# Transports
# --------------------------------------------------------------------------


class Engine:
    """Pipeline plus the temporal state machine for one session."""

    def __init__(self, landmarker):
        from pipeline import FacePipeline
        from rules import DrowsinessMonitor

        self.pipe = FacePipeline(landmarker_path=landmarker)
        self._new_monitor = DrowsinessMonitor
        self.monitor = DrowsinessMonitor()

    def step(self, frame, ts, reset=False):
        if reset:
            self.monitor = self._new_monitor()
        out = self.pipe.measure(frame, ts)
        v = self.monitor.update(out["signals"])
        return {
            "verdict": v.to_dict(),
            "box": out["box"],
            "landmarks": out.get("landmarks"),
            "head_pose": out.get("head_pose"),
            "timing_ms": out["timing_ms"],
        }


# --------------------------------------------------------------------------
# HUD
# --------------------------------------------------------------------------


def draw_hud(frame, result, net_ms, send_fps, alarm_phase):
    h, w = frame.shape[:2]
    if result is None:
        cv2.putText(frame, "loading model...", (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        return frame

    v = result["verdict"]
    level = v["level"]
    color = LEVEL_COLORS.get(level, (200, 200, 200))

    if v.get("face_lost_s", 0) >= 1.0:
        cv2.putText(frame, "NO FACE", (w // 2 - 110, h // 2 - 60),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.4, color, 4)

    # Face box
    box = result.get("box")
    if box:
        x1, y1, x2, y2 = (int(round(c)) for c in box[:4])
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(frame, f"face {box[4]:.2f}", (x1, max(14, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)

    # Landmark dots: green when open, red when the rule says closed / yawning
    lm = result.get("landmarks")
    if lm:
        eye_c = (60, 60, 255) if v["eyes_closed"] else (120, 240, 120)
        for key in ("left_eye", "right_eye"):
            for px, py in lm.get(key, []):
                cv2.circle(frame, (int(px), int(py)), 2, eye_c, -1)
        mouth_c = (40, 160, 255) if v["mouth_open"] else (120, 240, 120)
        for px, py in lm.get("mouth", []):
            cv2.circle(frame, (int(px), int(py)), 2, mouth_c, -1)

    # Status panel
    panel_h = 138
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, panel_h), (24, 24, 24), -1)
    cv2.addWeighted(overlay, 0.72, frame, 0.28, 0, frame)

    cv2.putText(frame, level, (16, 44), cv2.FONT_HERSHEY_SIMPLEX, 1.25, color, 3)

    # Score bar
    bar_x, bar_y, bar_w = 250, 22, min(320, w - 280)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + bar_w, bar_y + 22), (70, 70, 70), -1)
    filled = int(bar_w * min(100.0, v["score"]) / 100.0)
    cv2.rectangle(frame, (bar_x, bar_y), (bar_x + filled, bar_y + 22), color, -1)
    cv2.putText(frame, f"{v['score']:.0f}", (bar_x + bar_w + 10, bar_y + 18),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (230, 230, 230), 2)

    def fmt(x, nd=2):
        return "--" if x is None else f"{x:.{nd}f}"

    line1 = (f"EAR {fmt(v['ear'], 3)}/{fmt(v['ear_baseline'], 3)}  "
             f"MAR {fmt(v['mar'], 3)}  PERCLOS {v['perclos']*100:.0f}%  "
             f"shut {v['closure_s']:.1f}s")
    head = v.get("head_state", "forward")
    head_txt = head.upper() if head != "forward" else "forward"
    if v.get("head_drop_s", 0) >= 0.4 and head != "forward":
        head_txt += f" {v['head_drop_s']:.1f}s"
    if v.get("face_lost_s", 0) >= 0.5:
        head_txt += f"   NO FACE {v['face_lost_s']:.1f}s"
    line2 = (f"head {head_txt}  pitch {fmt(v['pitch_deg'], 0)}"
             f"/{fmt(v.get('pitch_baseline'), 0)}  yaw {fmt(v.get('yaw_deg'), 0)}  "
             f"roll {fmt(v.get('roll_deg'), 0)}")
    line3 = (f"yawns {v['yawns_in_window']}  microsleeps {v['microsleeps_recent']}  "
             f"blinks {v['blink_rate_per_min']:.0f}/min (not scored)")
    cv2.putText(frame, line1, (16, 74), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (220, 220, 220), 1)
    cv2.putText(frame, line2, (16, 94), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (190, 190, 190), 1)
    cv2.putText(frame, f"{net_ms:.0f}ms/frame  {send_fps:.1f} fps",
                (16, 112), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (150, 150, 150), 1)

    # Reasons, bottom-left
    for i, reason in enumerate(v.get("reasons", [])[:4]):
        cv2.putText(frame, f"- {reason}", (16, h - 16 - 20 * i),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

    # Pulsing border while the driver is judged sleepy
    if v["sleepy"]:
        thickness = 8 + int(6 * abs(np.sin(alarm_phase)))
        cv2.rectangle(frame, (0, 0), (w - 1, h - 1), color, thickness)
        cv2.putText(frame, "WAKE UP", (w // 2 - 130, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.6, color, 4)
    return frame


def beep():
    """Non-blocking audible alert; silently does nothing if unavailable."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(
                ["afplay", "/System/Library/Sounds/Sosumi.aiff"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        else:
            sys.stdout.write("\a")
            sys.stdout.flush()
    except Exception:
        pass


# --------------------------------------------------------------------------


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--landmarker", default=str(ROOT / "models" / "face_landmarker.task"))
    ap.add_argument("--camera", type=int, default=0)
    ap.add_argument("--width", type=int, default=960, help="capture width")
    ap.add_argument("--infer-width", type=int, default=0,
                    help="downscale before inference (0 = full frame)")
    ap.add_argument("--send-fps", type=float, default=0,
                    help="inference rate; 0 = as fast as it will go")
    ap.add_argument("--session", default=f"webcam-{int(time.time())}")
    ap.add_argument("--no-mirror", action="store_true")
    ap.add_argument("--no-sound", action="store_true")
    ap.add_argument("--record", default="", help="write the annotated view to this mp4")
    args = ap.parse_args()

    if not pathlib.Path(args.landmarker).exists():
        sys.exit(f"missing {args.landmarker}\n"
                 f"fetch it with:  ./scripts/fetch_model.sh")
    engine = Engine(args.landmarker)
    send_fps = args.send_fps or 30.0
    print(f"rate:    {send_fps:.0f} fps")
    print(f"session: {args.session}")

    cap = cv2.VideoCapture(args.camera)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    if not cap.isOpened():
        sys.exit(f"could not open camera {args.camera}")

    outbox: Queue = Queue(maxsize=1)
    state = {"result": None, "net_ms": 0.0, "stop": False, "sent": 0, "err": None}
    lock = threading.Lock()

    def worker():
        while not state["stop"]:
            try:
                payload, ts, reset, factor = outbox.get(timeout=0.25)
            except Empty:
                continue
            t0 = time.perf_counter()
            try:
                res = rescale(engine.step(payload, ts, reset), factor)
                with lock:
                    state["result"] = res
                    state["net_ms"] = (time.perf_counter() - t0) * 1000.0
                    state["sent"] += 1
                    state["err"] = None
            except Exception as exc:  # keep the preview alive on a bad frame
                with lock:
                    state["err"] = f"{type(exc).__name__}: {exc}"

    threading.Thread(target=worker, daemon=True).start()

    writer = None
    send_interval = 1.0 / max(0.5, send_fps)
    last_send = 0.0
    start = time.time()
    was_sleepy = False
    first = True

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if not args.no_mirror:
                frame = cv2.flip(frame, 1)

            now = time.time()
            if now - last_send >= send_interval and not outbox.full():
                small, factor = frame, 1.0
                if args.infer_width and frame.shape[1] > args.infer_width:
                    scale = args.infer_width / frame.shape[1]
                    small = cv2.resize(frame, None, fx=scale, fy=scale)
                    factor = 1.0 / scale   # map results back to display coords
                outbox.put((small.copy(), now, first, factor))
                first = False
                last_send = now

            with lock:
                result, net_ms, sent, err = (
                    state["result"], state["net_ms"], state["sent"], state["err"]
                )

            elapsed = max(1e-6, now - start)
            view = draw_hud(frame, result, net_ms, sent / elapsed, now * 6.0)

            if err:
                cv2.putText(view, err[:90], (16, view.shape[0] - 96),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (60, 60, 255), 1)

            if result and not args.no_sound:
                sleepy = result["verdict"]["sleepy"]
                if sleepy and not was_sleepy:
                    beep()
                was_sleepy = sleepy

            if args.record:
                if writer is None:
                    writer = cv2.VideoWriter(
                        args.record, cv2.VideoWriter_fourcc(*"mp4v"), 20.0,
                        (view.shape[1], view.shape[0]),
                    )
                writer.write(view)

            cv2.imshow("sleep detection  [q quit  r reset session]", view)
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("r"):
                first = True
                print("session reset")
    finally:
        state["stop"] = True
        cap.release()
        if writer is not None:
            writer.release()
            print(f"wrote {args.record}")
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
