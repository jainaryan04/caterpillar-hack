"""Run the full pipeline locally -- no Modal needed.

    python scripts/run_local.py samples/tired_driver_720p.mp4 --out annotated.mp4

Uses the same FacePipeline and DrowsinessMonitor the container runs, so this
is a faithful dry run of the deployment and a usable offline fallback.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "modal_app"))

import cv2  # noqa: E402

from pipeline import FacePipeline  # noqa: E402
from rules import DrowsinessMonitor  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
LEVEL_COLORS = {
    "ALERT": (90, 200, 90),
    "MILD": (60, 200, 250),
    "DROWSY": (40, 120, 255),
    "CRITICAL": (60, 60, 255),
    "UNKNOWN": (160, 160, 160),
}


def annotate(frame, v, box, lm):
    h, w = frame.shape[:2]
    color = LEVEL_COLORS.get(v.level, (200, 200, 200))
    if box:
        x1, y1, x2, y2 = (int(round(c)) for c in box[:4])
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
    if lm:
        eye_c = (60, 60, 255) if v.eyes_closed else (120, 240, 120)
        for key in ("left_eye", "right_eye"):
            for px, py in lm.get(key, []):
                cv2.circle(frame, (int(px), int(py)), 2, eye_c, -1)
        mouth_c = (40, 160, 255) if v.mouth_open else (120, 240, 120)
        for px, py in lm.get("mouth", []):
            cv2.circle(frame, (int(px), int(py)), 2, mouth_c, -1)

    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 96), (24, 24, 24), -1)
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
    cv2.putText(frame, v.level, (16, 46), cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)

    bar_w = min(300, w - 260)
    cv2.rectangle(frame, (230, 22), (230 + bar_w, 44), (70, 70, 70), -1)
    cv2.rectangle(frame, (230, 22),
                  (230 + int(bar_w * min(100, v.score) / 100), 44), color, -1)

    def f(x, nd=3):
        return "--" if x is None else f"{x:.{nd}f}"

    cv2.putText(frame,
                f"EAR {f(v.ear)}/{f(v.ear_baseline)}  MAR {f(v.mar)}  "
                f"PERCLOS {v.perclos*100:.0f}%  shut {v.closure_s:.1f}s  "
                f"pitch {f(v.pitch_deg, 0)}",
                (16, 72), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (220, 220, 220), 1)
    cv2.putText(frame, "  ".join(v.reasons[:3])[:96], (16, 90),
                cv2.FONT_HERSHEY_SIMPLEX, 0.46, color, 1)
    if v.sleepy:
        cv2.rectangle(frame, (0, 0), (w - 1, h - 1), color, 10)
    return frame


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", default="", help="write an annotated mp4 here")
    ap.add_argument("--json", default="", help="dump the timeline here")
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--yolo", default=str(pathlib.Path.home() / "Downloads" / "yolov12m-face.pt"))
    ap.add_argument("--landmarker", default=str(ROOT / "models" / "face_landmarker.task"))
    args = ap.parse_args()

    src = pathlib.Path(args.video)
    if not src.exists():
        sys.exit(f"{src} not found")

    print("loading models...")
    t0 = time.perf_counter()
    pipe = FacePipeline(landmarker_path=args.landmarker, yolo_path=args.yolo)
    print(f"  detector: {pipe.detector_name}  ({time.perf_counter()-t0:.1f}s)")
    if pipe.yolo_error:
        print(f"  yolo note: {pipe.yolo_error}")

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        sys.exit(f"could not open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = (cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
              if args.out else None)

    monitor = DrowsinessMonitor()
    timeline, transitions = [], []
    idx, prev, last = 0, None, None
    det_ms, lm_ms, scored = 0.0, 0.0, 0
    t_start = time.perf_counter()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if idx % max(1, args.stride) == 0:
            ts = idx / fps
            out = pipe.measure(frame, ts)
            v = monitor.update(out["signals"])
            det_ms += out["timing_ms"]["detect"]
            lm_ms += out["timing_ms"]["landmark"]
            scored += 1
            last = (v, out.get("box"), out.get("landmarks"))
            timeline.append({
                "t": round(ts, 3), "frame": idx, "level": v.level, "score": v.score,
                "ear": v.ear, "mar": v.mar, "perclos": v.perclos,
                "closure_s": v.closure_s, "pitch": v.pitch_deg,
                "blink": out["signals"].blink_score,
                "jaw": out["signals"].jaw_open_score,
                "face": v.face_found,
            })
            if v.level != prev:
                transitions.append({"t": round(ts, 3), "level": v.level,
                                    "reasons": v.reasons})
                prev = v.level
        if writer is not None and last is not None:
            writer.write(annotate(frame, last[0], last[1], last[2]))
        idx += 1

    cap.release()
    if writer is not None:
        writer.release()

    wall = time.perf_counter() - t_start
    drowsy = [p for p in timeline if p["level"] in ("DROWSY", "CRITICAL")]
    faces = [p for p in timeline if p["face"]]

    print(f"\n{scored}/{idx} frames scored in {wall:.1f}s "
          f"({scored/max(wall,1e-6):.1f} fps)")
    print(f"  detect  {det_ms/max(scored,1):.1f} ms/frame")
    print(f"  landmark{lm_ms/max(scored,1):6.1f} ms/frame")
    print(f"face found      : {len(faces)}/{scored} frames ({len(faces)/max(scored,1):.0%})")
    print(f"drowsy fraction : {len(drowsy)/max(len(timeline),1):.1%}")
    print(f"peak score      : {max((p['score'] for p in timeline), default=0)}")

    ears = [p["ear"] for p in timeline if p["ear"] is not None]
    pitches = [p["pitch"] for p in timeline if p["pitch"] is not None]
    if ears:
        print(f"EAR   min {min(ears):.3f}  max {max(ears):.3f}")
    if pitches:
        print(f"pitch min {min(pitches):+.1f}  max {max(pitches):+.1f}")

    print("\nstate changes:")
    for e in transitions:
        print(f"  t={e['t']:>7.2f}s  {e['level']:<9} {', '.join(e['reasons'])}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(
            {"timeline": timeline, "transitions": transitions}, indent=2))
        print(f"\ntimeline -> {args.json}")
    if args.out:
        print(f"annotated -> {args.out}")


if __name__ == "__main__":
    main()
