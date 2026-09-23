"""Score a site video on Modal, then render the result locally.

    python scripts/run_video.py clip.mp4 --out annotated.mp4
"""

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys

import cv2
import modal

APP, CLS = "site-safety", "PPEDetector"
GREEN, RED, AMBER, GREY = (90, 200, 90), (60, 60, 255), (40, 160, 255), (170, 170, 170)


def render(src: str, dst: str, timeline: list, fps: float) -> None:
    """Draw each person's box and what they are missing, held between samples."""
    by_frame = {r["frame"]: r for r in timeline}
    cap = cv2.VideoCapture(src)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))

    idx, cur = 0, None
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        cur = by_frame.get(idx, cur)
        if cur:
            for p in cur["people"]:
                x1, y1, x2, y2 = (int(round(c)) for c in p["box"])
                color = GREEN if p["compliant"] else (RED if p["flagged"] else AMBER)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                tag = "OK" if p["compliant"] else "no " + "+".join(p["missing"])
                cv2.rectangle(frame, (x1, max(0, y1 - 22)), (x1 + 150, y1), color, -1)
                cv2.putText(frame, f"#{p['track_id']} {tag}", (x1 + 4, max(12, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 1)
            bad = cur["n_flagged"]
            band = RED if bad else GREEN
            cv2.rectangle(frame, (0, 0), (w, 34), (24, 24, 24), -1)
            cv2.putText(frame,
                        f"t={cur['t']:6.1f}s   people {cur['n_people']}   "
                        f"violations {bad}",
                        (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, band, 2)
        idx += 1
        out.write(frame)
    cap.release()
    out.release()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--out", default="", help="write an annotated mp4 here")
    ap.add_argument("--json", default="", help="dump the full result here")
    ap.add_argument("--snapshots", default="", help="save violation frames to this dir")
    ap.add_argument("--stride", type=int, default=3, help="score every Nth frame")
    ap.add_argument("--conf", type=float, default=0.35)
    args = ap.parse_args()

    src = pathlib.Path(args.video)
    if not src.exists():
        sys.exit(f"{src} not found")
    data = src.read_bytes()

    det = modal.Cls.from_name(APP, CLS)()
    print(f"uploading {len(data)/1e6:.1f} MB, scoring every {args.stride} frame(s)...")
    r = det.process_video.remote(data, args.stride, args.conf)

    v = r["video"]
    print(f"\n{v['width']}x{v['height']} @ {v['fps']}fps, {v['duration_s']}s "
          f"({v['frames']} frames)")
    print(f"scored {r['scored_frames']} frames in {r['wall_s']}s "
          f"({r['scored_frames']/max(r['wall_s'],0.01):.1f} fps)")
    print(f"peak people in frame : {r['peak_people']}")
    print(f"people tracked       : {r['people_tracked']}")
    print(f"frames with an open violation: {r['violation_frame_fraction']:.1%}")
    print(f"\nconfirmed violations : {r['violations']}")
    for x in r["violation_list"]:
        print(f"  person #{x['track_id']:<3} t={x['start']:6.1f}-{x['end']:6.1f}s "
              f"({x['duration']:5.1f}s)  missing: {', '.join(x['missing'])}")
    if not r["violation_list"]:
        print("  none - everyone tracked was wearing helmet and vest")

    if args.snapshots:
        d = pathlib.Path(args.snapshots); d.mkdir(parents=True, exist_ok=True)
        for fidx, b64 in r["snapshots"].items():
            (d / f"violation_frame_{fidx}.jpg").write_bytes(base64.b64decode(b64))
        print(f"\n{len(r['snapshots'])} snapshot(s) -> {d}/")
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(r, indent=2))
        print(f"result -> {args.json}")
    if args.out:
        print(f"rendering -> {args.out}")
        render(str(src), args.out, r["timeline"], v["fps"])
        print("done")


if __name__ == "__main__":
    main()
