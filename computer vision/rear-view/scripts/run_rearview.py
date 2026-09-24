"""Rear-view proximity alert: anything too close behind, and you get told.

    python scripts/run_rearview.py clip.mp4
    python scripts/run_rearview.py inputs/site.avif --danger 0.8 --warn 0.6
    python scripts/run_rearview.py clip.mp4 --no-remote --hold 5

Same stack as ../depth-estimation -- yolo11m locally, the construction
equipment endpoint over HTTP, Depth Anything V2 for distance -- imported from
there rather than copied, so a fix lands in both. What this adds is the
reversing decision: three bands, a debounced verdict, and a display that reads
from across a cab.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parents[1]
SHARED = HERE.parents[0] / "depth-estimation" / "depth"
if not (SHARED / "model.py").is_file():
    raise SystemExit(f"shared modules not found at {SHARED} -- "
                     "rear-view reuses ../depth-estimation, keep them side by side")
sys.path.insert(0, str(SHARED))
sys.path.insert(0, str(HERE / "rearview"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import display  # noqa: E402
import fuse  # noqa: E402
import overlay  # noqa: E402
from detect import Detector  # noqa: E402
from model import MODEL_CONFIGS, DepthEstimator  # noqa: E402
from proximity import ProximityScorer, frame_range  # noqa: E402
from remote import RemoteDetector, RemoteError, load_api_key  # noqa: E402
from zones import DANGER, Bands, RearView  # noqa: E402

VIDEO_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm"}


def detect_all(frame, local, remote, cache=None, iou=0.55, max_box_frac=0.9):
    groups = [fuse.tag(local.detect(frame), "coco")]
    remote_dets, err = cache, None
    if remote is not None and cache is None:
        try:
            remote_dets = fuse.tag(remote.detect(frame), "remote")
        except RemoteError as exc:
            remote_dets, err = [], exc
    if remote_dets:
        groups.append(remote_dets)
    merged = fuse.merge(groups, iou)
    if max_box_frac < 1.0:
        h, w = frame.shape[:2]
        limit = float(h) * w * max_box_frac
        merged = [d for d in merged
                  if (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]) < limit]
    return merged, remote_dets, err


def render(frame, depth, verdict, objects, view, cmap, extra=""):
    heat = overlay.heatmap(depth, cmap)
    canvas = display.compose(frame, heat, view)
    if view == "split":
        dx = frame.shape[1] + max(8, frame.shape[1] // 80)
        canvas = display.draw_objects(canvas, objects)
        canvas = display.draw_objects(canvas, objects, dx=dx)
    else:
        canvas = display.draw_objects(canvas, objects)
    return display.draw_verdict(canvas, verdict, objects, extra)


def build(args):
    local = Detector(backend="coco", conf=args.conf, imgsz=args.imgsz,
                     device=args.device)
    est = DepthEstimator(encoder=args.encoder, device=args.device,
                         input_size=args.input_size)
    remote = None
    if not args.no_remote and load_api_key():
        remote = RemoteDetector(conf=args.remote_conf, imgsz=args.remote_imgsz)
    elif not args.no_remote:
        print("no ULTRALYTICS_API_KEY -- local detector only", file=sys.stderr)
    return local, remote, est


def run_image(args, local, remote, est, monitor, scorer) -> int:
    src = pathlib.Path(args.src).expanduser()
    frame = cv2.imread(str(src))
    if frame is None:
        print(f"cv2 could not read {src}", file=sys.stderr)
        return 1

    depth = est.infer(frame)
    merged, _, err = detect_all(frame, local, remote, iou=args.iou,
                                max_box_frac=args.max_box_frac)
    if err:
        print(f"endpoint unavailable, local only: {err}", file=sys.stderr)
    scorer.reference = frame_range(depth)
    verdict, objects = monitor.assess(scorer.score(depth, merged))

    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(outdir / f"{src.stem}_rearview.png"),
                render(frame, depth, verdict, objects, args.view, args.cmap))
    (outdir / f"{src.stem}_rearview.json").write_text(json.dumps(
        {"source": str(src), "verdict": verdict,
         "bands": {"danger": args.danger, "warn": args.warn},
         "objects": [o.as_dict() | {"source": o.source} for o in objects]}, indent=2))

    print(f"VERDICT: {verdict}   ({len(objects)} objects)")
    for o in objects:
        mark = "*" if o.source == "remote" else " "
        print(f"  {o.level:<7}{mark}{o.label:<10} proximity {o.proximity:.2f}  "
              f"conf {o.confidence:.2f}")
    print(f"wrote {outdir / f'{src.stem}_rearview.png'}")
    return 0


def scan_reference(est, path, n_frames, samples):
    cap = cv2.VideoCapture(str(path))
    los, his = [], []
    for idx in np.unique(np.linspace(0, max(n_frames - 1, 0), samples).astype(int)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok:
            continue
        lo, hi = frame_range(est.infer(frame))
        los.append(lo)
        his.append(hi)
    cap.release()
    if not los:
        raise RuntimeError("could not read any frame while scanning")
    return min(los), max(his)


def run_video(args, local, remote, est, monitor, scorer) -> int:
    src = pathlib.Path(args.src).expanduser()
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        print(f"cv2 could not open {src}", file=sys.stderr)
        return 1
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    print(f"{src.name}: {n_frames} frames @ {fps:.2f} fps")

    scorer.reference = scan_reference(est, src, n_frames, args.norm_samples)
    print(f"clip depth range: {scorer.reference[0]:.2f}-{scorer.reference[1]:.2f}")

    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out_path = outdir / f"{src.stem}_rearview.mp4"

    writer, rows, processed, index = None, [], 0, -1
    last_remote, transitions = None, []
    t_start = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index += 1
        if index % args.stride:
            continue

        depth = est.infer(frame)
        due = remote is not None and processed % max(1, args.remote_every) == 0
        merged, fresh, err = detect_all(frame, local, remote,
                                        cache=None if due else last_remote,
                                        iou=args.iou, max_box_frac=args.max_box_frac)
        if due and not err:
            last_remote = fresh

        previous = monitor.debounce.level
        verdict, objects = monitor.assess(scorer.score(depth, merged))
        if verdict != previous:
            transitions.append({"t": round(index / fps, 3), "from": previous, "to": verdict})

        canvas = render(frame, depth, verdict, objects, args.view, args.cmap,
                        extra=f"t={index / fps:.1f}s")
        if args.max_height and canvas.shape[0] > args.max_height:
            s = args.max_height / canvas.shape[0]
            canvas = cv2.resize(canvas, (int(canvas.shape[1] * s), args.max_height),
                                interpolation=cv2.INTER_AREA)
        if writer is None:
            ch, cw = canvas.shape[:2]
            writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"),
                                     fps / args.stride, (cw, ch))
            print(f"writing {cw}x{ch} -> {out_path}")
        writer.write(canvas)

        rows.append({"frame": index, "t": round(index / fps, 3), "verdict": verdict,
                     "objects": [o.as_dict() | {"source": o.source} for o in objects]})
        processed += 1
        if processed % 25 == 0:
            print(f"  {processed} frames  (verdict {verdict})")
        if args.limit and processed >= args.limit:
            break

    cap.release()
    if writer:
        writer.release()
    if not processed:
        print("no frames processed", file=sys.stderr)
        return 1

    (outdir / f"{src.stem}_rearview.json").write_text(json.dumps(
        {"source": str(src), "bands": {"danger": args.danger, "warn": args.warn},
         "hold": args.hold, "transitions": transitions, "frames": rows}, indent=2))

    counts = collections.Counter(r["verdict"] for r in rows)
    prox = np.array([o["proximity"] for r in rows for o in r["objects"]])
    print(f"done: {processed} frames in {time.perf_counter() - t_start:.0f}s")
    print(f"  verdicts: {dict(counts)}")
    print(f"  transitions: {len(transitions)}")
    for t in transitions[:6]:
        print(f"    t={t['t']:>6.2f}s  {t['from']} -> {t['to']}")
    if prox.size:
        print(f"  proximity seen: max {prox.max():.2f}, p90 {np.percentile(prox, 90):.2f}")
        if prox.max() < args.danger:
            print(f"  NOTE: nothing reached --danger {args.danger:g}; "
                  f"set the bands from this camera's own footage.")
    print(f"wrote {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Rear-view proximity alerting")
    ap.add_argument("src", help="image or video")
    ap.add_argument("--outdir", default=str(HERE / "out"))
    ap.add_argument("--danger", type=float, default=0.75, help="proximity for STOP")
    ap.add_argument("--warn", type=float, default=0.55, help="proximity for CAUTION")
    ap.add_argument("--hold", type=int, default=3,
                    help="calmer frames needed before standing down (escalation "
                         "is always immediate)")
    ap.add_argument("--view", default="split", choices=["heatmap", "frame", "split"])
    ap.add_argument("--cmap", default="Spectral_r")
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--no-remote", action="store_true")
    ap.add_argument("--remote-conf", type=float, default=0.25)
    ap.add_argument("--remote-imgsz", type=int, default=640)
    ap.add_argument("--remote-every", type=int, default=1)
    ap.add_argument("--iou", type=float, default=0.55)
    ap.add_argument("--max-box-frac", type=float, default=0.9,
                    help="drop boxes covering more of the frame than this -- on a "
                         "reversing camera that is the machine's own bodywork")
    ap.add_argument("--encoder", default="vitb", choices=list(MODEL_CONFIGS))
    ap.add_argument("--input-size", type=int, default=518)
    ap.add_argument("--device", default=None, choices=["cuda", "mps", "cpu"])
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-height", type=int, default=960)
    ap.add_argument("--norm-samples", type=int, default=24)
    args = ap.parse_args()

    src = pathlib.Path(args.src).expanduser()
    if not src.is_file():
        print(f"no such file: {src}", file=sys.stderr)
        return 1

    try:
        bands = Bands(danger=args.danger, warn=args.warn)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    try:
        local, remote, est = build(args)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1

    monitor = RearView(bands, hold=args.hold)
    # The bands here own the levels; the shared scorer only supplies proximity,
    # and assess() overwrites whatever it labelled.
    scorer = ProximityScorer(alert_at=1.0, warn_at=1.0)
    print(f"rear view  |  detectors: coco{'+equipment' if remote else ''}  |  "
          f"depth {args.encoder} on {est.device}")
    print(f"bands: STOP >= {args.danger:g}, CAUTION >= {args.warn:g}, hold {args.hold}")

    if src.suffix.lower() in VIDEO_SUFFIXES:
        return run_video(args, local, remote, est, monitor, scorer)
    return run_image(args, local, remote, est, monitor, scorer)


if __name__ == "__main__":
    raise SystemExit(main())
