"""Score a recorded clip on Modal, then burn the verdict onto a local copy.

    python scripts/run_video.py clip.mp4 --out annotated.mp4

The clip is uploaded once and scored entirely server-side, which is far
faster than round-tripping every frame. The returned timeline is then used to
render the overlay locally.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import cv2
import modal

APP_NAME = "sleep-detection"
CLASS_NAME = "SleepDetector"

LEVEL_COLORS = {
    "ALERT": (90, 200, 90),
    "MILD": (60, 200, 250),
    "DROWSY": (40, 120, 255),
    "CRITICAL": (60, 60, 255),
    "UNKNOWN": (160, 160, 160),
}


def render(src: str, dst: str, timeline: list) -> None:
    """Overlay the per-frame verdict, holding the last value between samples."""
    by_frame = {p["frame"]: p for p in timeline}
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        sys.exit(f"could not open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    writer = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    idx, current = 0, None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        current = by_frame.get(idx, current)
        if current:
            color = LEVEL_COLORS.get(current["level"], (200, 200, 200))
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (w, 88), (24, 24, 24), -1)
            cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
            cv2.putText(frame, current["level"], (16, 46),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.1, color, 3)
            bar_w = min(300, w - 260)
            cv2.rectangle(frame, (230, 22), (230 + bar_w, 44), (70, 70, 70), -1)
            cv2.rectangle(frame, (230, 22),
                          (230 + int(bar_w * min(100, current["score"]) / 100), 44),
                          color, -1)
            ear = "--" if current["ear"] is None else f"{current['ear']:.3f}"
            mar = "--" if current["mar"] is None else f"{current['mar']:.3f}"
            cv2.putText(frame,
                        f"t={current['t']:.1f}s  score {current['score']:.0f}  "
                        f"EAR {ear}  MAR {mar}  PERCLOS {current['perclos']*100:.0f}%"
                        f"  shut {current['closure_s']:.1f}s",
                        (16, 74), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)
            if current["level"] in ("DROWSY", "CRITICAL"):
                cv2.rectangle(frame, (0, 0), (w - 1, h - 1), color, 10)
        idx += 1
        writer.write(frame)

    cap.release()
    writer.release()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", default="", help="write an annotated mp4 here")
    ap.add_argument("--stride", type=int, default=1, help="score every Nth frame")
    ap.add_argument("--json", default="", help="dump the full timeline here")
    args = ap.parse_args()

    path = pathlib.Path(args.video)
    if not path.exists():
        sys.exit(f"{path} not found")
    data = path.read_bytes()

    det = modal.Cls.from_name(APP_NAME, CLASS_NAME)()
    print(f"uploading {len(data)/1e6:.1f} MB, scoring every {args.stride} frame(s)...")
    res = det.process_video.remote(data, args.stride)

    print(f"\n{res['frames_scored']}/{res['frames_read']} frames scored "
          f"over {res['duration_s']}s @ {res['fps']} fps")
    print(f"drowsy fraction : {res['drowsy_fraction']:.1%}")
    print(f"peak score      : {res['peak_score']}")
    print("\nstate changes:")
    for e in res["transitions"]:
        print(f"  t={e['t']:>7.2f}s  {e['level']:<9} {', '.join(e['reasons'])}")

    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(res, indent=2))
        print(f"\ntimeline -> {args.json}")
    if args.out:
        print(f"rendering overlay -> {args.out}")
        render(str(path), args.out, res["timeline"])
        print("done")


if __name__ == "__main__":
    main()
