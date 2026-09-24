"""Proximity alerts over people, vehicles and construction equipment.

    python scripts/run_alert.py inputs/site.avif
    python scripts/run_alert.py clip.mp4 --alert 0.5 --remote-every 5
    python scripts/run_alert.py inputs/site.avif --no-remote

Three models, each doing what it is good at:

  yolo11m (local)        people and road vehicles -- COCO
  equipment model (HTTP) excavators, cranes, tractors, trucks -- the classes
                         COCO does not have. Needs ULTRALYTICS_API_KEY.
  Depth Anything V2      how near each of them is

Both detectors' results land in the same frame; `depth/fuse.py` decides who
wins when they box the same object. Equipment-model boxes are drawn heavier
and their labels prefixed with `*`.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "depth"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import fuse  # noqa: E402
import overlay  # noqa: E402
from detect import Detector  # noqa: E402
from model import MODEL_CONFIGS, DepthEstimator  # noqa: E402
from proximity import ProximityScorer, frame_range  # noqa: E402
from remote import API_KEY_ENV, RemoteDetector, RemoteError, load_api_key  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
VIDEO_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm"}


def drop_ego(dets, frame_shape, max_frac):
    """Discard boxes covering most of the frame.

    On a dashcam the detector boxes the vehicle it is mounted in -- the sample
    car shot returns two `car` boxes, one spanning 99% of the image -- and that
    box is by definition the nearest thing in the depth map, so it alerts on
    every frame forever. Area is a blunt filter but it kills the full-frame
    case; a fixed mount really wants a static ignore mask.
    """
    if max_frac >= 1.0:
        return dets
    h, w = frame_shape[:2]
    limit = float(h) * w * max_frac
    return [d for d in dets
            if (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]) < limit]


def detect_both(frame, local, remote, cache=None, iou_thresh=0.55, people_only=False,
                max_box_frac=1.0):
    """Run whichever detectors are available and merge the results.

    `cache` lets video reuse the last remote answer between calls: the
    endpoint is a network round trip per frame, which is far slower than
    either local model.
    """
    groups = [fuse.tag(local.detect(frame), "coco")]
    remote_dets, err = cache, None
    if remote is not None and cache is None:
        try:
            remote_dets = fuse.tag(remote.detect(frame), "remote")
        except RemoteError as exc:
            remote_dets, err = [], exc
    if remote_dets:
        groups.append(remote_dets)
    merged = fuse.merge(groups, iou_thresh)
    merged = drop_ego(merged, frame.shape, max_box_frac)
    if people_only:
        merged = [d for d in merged if d.kind == "person"]
    return merged, remote_dets, err


def render(frame, depth, scored, view, cmap, extra=""):
    heat = overlay.heatmap(depth, cmap)
    canvas = overlay.compose(frame, heat, view)
    if view == "split":
        dx = frame.shape[1] + max(8, frame.shape[1] // 80)
        canvas = overlay.draw_people(canvas, scored)
        canvas = overlay.draw_people(canvas, scored, dx=dx)
    else:
        canvas = overlay.draw_people(canvas, scored)
    return overlay.draw_banner(canvas, scored, extra)


def summarise(scored) -> str:
    by_source = collections.Counter(s.source for s in scored)
    return "  ".join(f"{k}:{v}" for k, v in sorted(by_source.items())) or "none"


def run_image(args, local, remote, est, scorer) -> int:
    src = pathlib.Path(args.src).expanduser()
    frame = cv2.imread(str(src))
    if frame is None:
        print(f"cv2 could not read {src}", file=sys.stderr)
        return 1

    depth = est.infer(frame)
    merged, _, err = detect_both(frame, local, remote, iou_thresh=args.iou,
                                 people_only=args.people_only,
                                 max_box_frac=args.max_box_frac)
    if err:
        print(f"equipment endpoint unavailable, COCO only: {err}", file=sys.stderr)
    scorer.reference = frame_range(depth)
    scored = scorer.score(depth, merged)

    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(outdir / f"{src.stem}_alert.png"),
                render(frame, depth, scored, args.view, args.cmap))
    (outdir / f"{src.stem}_alert.json").write_text(json.dumps(
        {"source": str(src), "alert_at": args.alert,
         "detections": [s.as_dict() | {"source": s.source} for s in scored]}, indent=2))

    print(f"{len(scored)} detections ({summarise(scored)}), nearest first:")
    for s in scored:
        mark = "*" if s.source == "remote" else " "
        print(f"  {s.level:<6}{mark}{s.label:<14} proximity {s.proximity:.2f}  "
              f"conf {s.confidence:.2f}  box {s.box}")
    print(f"wrote {outdir / f'{src.stem}_alert.png'}")
    return 0


def scan_reference(est, path, n_frames, samples):
    """One depth range for the whole clip, so scores do not flicker."""
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


def run_video(args, local, remote, est, scorer) -> int:
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
    out_path = outdir / f"{src.stem}_alert.mp4"

    writer, rows, processed, index = None, [], 0, -1
    last_remote, remote_calls, remote_fails = None, 0, 0
    t_start = time.perf_counter()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index += 1
        if index % args.stride:
            continue

        depth = est.infer(frame)
        # Call the endpoint only every Nth processed frame; reuse in between.
        due = remote is not None and processed % max(1, args.remote_every) == 0
        merged, fresh, err = detect_both(frame, local, remote,
                                         cache=None if due else last_remote,
                                         iou_thresh=args.iou,
                                         people_only=args.people_only,
                                         max_box_frac=args.max_box_frac)
        if due:
            remote_calls += 1
            if err:
                remote_fails += 1
                if remote_fails == 1:
                    print(f"  equipment endpoint error: {err}", file=sys.stderr)
            else:
                last_remote = fresh

        scored = scorer.score(depth, merged)
        canvas = render(frame, depth, scored, args.view, args.cmap,
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

        rows.append({"frame": index, "t": round(index / fps, 3),
                     "detections": [s.as_dict() | {"source": s.source} for s in scored]})
        processed += 1
        if processed % 25 == 0:
            print(f"  {processed} frames  ({summarise(scored)})")
        if args.limit and processed >= args.limit:
            break

    cap.release()
    if writer:
        writer.release()
    if not processed:
        print("no frames processed", file=sys.stderr)
        return 1

    (outdir / f"{src.stem}_alert.json").write_text(json.dumps(
        {"source": str(src), "alert_at": args.alert, "frames": rows}, indent=2))

    alerts = [r for r in rows if any(d["level"] == "ALERT" for d in r["detections"])]
    scores = np.array([d["proximity"] for r in rows for d in r["detections"]])
    labels = collections.Counter(d["label"] for r in rows for d in r["detections"])
    print(f"done: {processed} frames in {time.perf_counter() - t_start:.0f}s")
    print(f"  labels seen: {dict(labels.most_common(8))}")
    if remote is not None:
        print(f"  endpoint calls: {remote_calls} ({remote_fails} failed)")
    print(f"  frames with an ALERT: {len(alerts)}/{len(rows)}")
    if alerts:
        print(f"  first alert at t={alerts[0]['t']:.2f}s")
    if scores.size:
        print(f"  proximity seen: max {scores.max():.2f}, p90 {np.percentile(scores, 90):.2f}")
        if scores.max() < args.alert:
            print(f"  NOTE: nothing reached --alert {args.alert:.2f}; "
                  f"lower it to suit this camera.")
    print(f"wrote {out_path}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Proximity alerts from depth + two detectors")
    ap.add_argument("src", help="image or video")
    ap.add_argument("--outdir", default=str(ROOT / "out"))
    ap.add_argument("--alert", type=float, default=0.75,
                    help="proximity 0-1 at which to alert (default 0.75)")
    ap.add_argument("--view", default="split", choices=["heatmap", "frame", "split"])
    ap.add_argument("--cmap", default="Spectral_r")
    # local detector
    ap.add_argument("--conf", type=float, default=0.25)
    ap.add_argument("--imgsz", type=int, default=960)
    ap.add_argument("--people-only", action="store_true",
                    help="drop vehicles and equipment, alert on people alone")
    # remote equipment model
    ap.add_argument("--no-remote", action="store_true",
                    help="skip the equipment endpoint even if a key is set")
    ap.add_argument("--endpoint", default=None)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--remote-conf", type=float, default=0.25)
    ap.add_argument("--remote-imgsz", type=int, default=640)
    ap.add_argument("--remote-every", type=int, default=1,
                    help="call the endpoint every Nth frame (video); reuse in between")
    ap.add_argument("--max-box-frac", type=float, default=0.9,
                    help="drop boxes covering more than this fraction of the "
                         "frame -- the ego vehicle on a dashcam (1.0 disables)")
    ap.add_argument("--iou", type=float, default=0.55,
                    help="cross-detector overlap above which the owning model wins")
    # depth
    ap.add_argument("--encoder", default="vitb", choices=list(MODEL_CONFIGS))
    ap.add_argument("--input-size", type=int, default=518)
    ap.add_argument("--device", default=None, choices=["cuda", "mps", "cpu"])
    # video
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
        local = Detector(backend="coco", conf=args.conf, imgsz=args.imgsz,
                         device=args.device)
        est = DepthEstimator(encoder=args.encoder, device=args.device,
                             input_size=args.input_size)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1

    remote = None
    if not args.no_remote:
        if args.api_key or load_api_key():
            # The endpoint rejects conf below 0.01, so clamp rather than throw
            # when the local detector is asked for something lower.
            remote_conf = min(1.0, max(0.01, args.remote_conf))
            if remote_conf != args.remote_conf:
                print(f"endpoint floors conf at 0.01; using {remote_conf} for it "
                      f"(local stays at {args.conf})", file=sys.stderr)
            try:
                remote = RemoteDetector(endpoint=args.endpoint, api_key=args.api_key,
                                        conf=remote_conf, imgsz=args.remote_imgsz)
            except (ValueError, RemoteError) as exc:
                print(f"equipment endpoint unavailable: {exc}", file=sys.stderr)
        else:
            print(f"no {API_KEY_ENV} set -- running COCO only. Export the key to "
                  f"add excavator/crane/tractor detection.", file=sys.stderr)

    scorer = ProximityScorer(alert_at=args.alert, warn_at=args.alert)
    print(f"detectors: coco{'+equipment' if remote else ''}  |  "
          f"depth {args.encoder} on {est.device}  |  alert at {args.alert:g}")

    if src.suffix.lower() in VIDEO_SUFFIXES:
        return run_video(args, local, remote, est, scorer)
    return run_image(args, local, remote, est, scorer)


if __name__ == "__main__":
    raise SystemExit(main())
