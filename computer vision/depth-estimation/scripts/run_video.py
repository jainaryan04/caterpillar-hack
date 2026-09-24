"""Run Depth Anything V2 over a video.

    python scripts/run_video.py clip.mp4 --out out/clip_depth.mp4

The model is per-frame and has no temporal component, so this is just
run_image in a loop -- with one addition that matters: normalisation is
computed once for the whole clip rather than per frame. See --norm.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "depth"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import colorize  # noqa: E402
from model import MODEL_CONFIGS, DepthEstimator  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]


def fit(frame: np.ndarray, max_height: int) -> np.ndarray:
    """Shrink to max_height, preserving aspect. 4K side-by-side is unwatchable."""
    h, w = frame.shape[:2]
    if max_height <= 0 or h <= max_height:
        return frame
    scale = max_height / h
    return cv2.resize(frame, (int(round(w * scale)), max_height),
                      interpolation=cv2.INTER_AREA)


def scan_range(est, path, n_frames, samples, lo_pct, hi_pct):
    """Percentile depth range over frames sampled across the clip.

    Percentiles rather than min/max: a handful of speckle pixels at either end
    would otherwise set the range for the entire video.
    """
    cap = cv2.VideoCapture(str(path))
    indices = np.unique(np.linspace(0, max(n_frames - 1, 0), samples).astype(int))
    los, his = [], []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(idx))
        ok, frame = cap.read()
        if not ok:
            continue
        depth = est.infer(frame)
        los.append(np.percentile(depth, lo_pct))
        his.append(np.percentile(depth, hi_pct))
    cap.release()
    if not los:
        raise RuntimeError("could not read any frame while scanning the clip")
    return float(min(los)), float(max(his))


def main() -> int:
    ap = argparse.ArgumentParser(description="Depth Anything V2 video inference")
    ap.add_argument("video")
    ap.add_argument("--out", default=None, help="default: out/<stem>_depth.mp4")
    ap.add_argument("--mode", default="side-by-side",
                    choices=["side-by-side", "color", "gray"])
    ap.add_argument("--encoder", default="vitb", choices=list(MODEL_CONFIGS))
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--input-size", type=int, default=518)
    ap.add_argument("--device", default=None, choices=["cuda", "mps", "cpu"])
    ap.add_argument("--cmap", default="Spectral_r")
    ap.add_argument("--max-height", type=int, default=960,
                    help="downscale the written frames (0 keeps source size)")
    ap.add_argument("--stride", type=int, default=1,
                    help="process every Nth frame; output fps is divided to match")
    ap.add_argument("--limit", type=int, default=0, help="stop after N processed frames")
    ap.add_argument("--norm", default="global", choices=["global", "frame"],
                    help="global: one range for the clip (steady). frame: per-frame (flickers)")
    ap.add_argument("--norm-samples", type=int, default=24)
    ap.add_argument("--norm-pct", type=float, nargs=2, default=(1.0, 99.0),
                    metavar=("LO", "HI"))
    ap.add_argument("--npy", default=None,
                    help="also save every processed depth map to this .npz")
    args = ap.parse_args()

    src = pathlib.Path(args.video).expanduser()
    if not src.is_file():
        print(f"no such video: {src}", file=sys.stderr)
        return 1

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        print(f"cv2 could not open {src}", file=sys.stderr)
        return 1
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"{src.name}: {w}x{h}  {fps:.2f} fps  {n_frames} frames  {n_frames / fps:.1f} s")

    try:
        est = DepthEstimator(encoder=args.encoder, checkpoint=args.checkpoint,
                             device=args.device, input_size=args.input_size)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1
    print(f"{args.encoder} on {est.device}  <-  {est.checkpoint.name}")

    fixed_range = None
    if args.norm == "global":
        t0 = time.perf_counter()
        lo, hi = scan_range(est, src, n_frames, args.norm_samples, *args.norm_pct)
        fixed_range = (lo, hi)
        print(f"global range p{args.norm_pct[0]:g}-p{args.norm_pct[1]:g} = "
              f"{lo:.2f}-{hi:.2f}  ({time.perf_counter() - t0:.1f}s scan)")

    out_path = pathlib.Path(args.out) if args.out else ROOT / "out" / f"{src.stem}_depth.mp4"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    writer = None
    processed, times = 0, []
    index = -1
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        index += 1
        if index % args.stride:
            continue

        t0 = time.perf_counter()
        depth = est.infer(frame)
        times.append((time.perf_counter() - t0) * 1000.0)

        if fixed_range is not None:
            lo, hi = fixed_range
            shown = np.clip((depth - lo) / (hi - lo + 1e-8), 0.0, 1.0)
        else:
            shown = colorize.normalize(depth)

        if args.mode == "gray":
            vis = cv2.cvtColor((shown * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
        else:
            import matplotlib
            rgb = matplotlib.colormaps.get_cmap(args.cmap)(shown)
            vis = (rgb[:, :, :3] * 255).astype(np.uint8)[:, :, ::-1]

        canvas = colorize.side_by_side(frame, vis) if args.mode == "side-by-side" else vis
        canvas = fit(canvas, args.max_height)

        if writer is None:
            # Size comes from the first finished frame, so fit() and the mode
            # cannot disagree with the header.
            ch, cw = canvas.shape[:2]
            writer = cv2.VideoWriter(str(out_path),
                                     cv2.VideoWriter_fourcc(*"mp4v"),
                                     fps / args.stride, (cw, ch))
            if not writer.isOpened():
                print(f"could not open a writer for {out_path}", file=sys.stderr)
                return 1
            print(f"writing {cw}x{ch} @ {fps / args.stride:.2f} fps -> {out_path}")
        writer.write(canvas)

        processed += 1
        if processed % 25 == 0:
            print(f"  {processed} frames  ({np.median(times[1:] or times):.0f} ms/frame)")
        if args.limit and processed >= args.limit:
            break

    cap.release()
    if writer is not None:
        writer.release()
    if not processed:
        print("no frames processed", file=sys.stderr)
        return 1

    median = np.median(times[1:] or times)
    print(f"done: {processed} frames, first {times[0]:.0f} ms, median {median:.0f} ms, "
          f"{processed * median / 1000:.0f}s total inference")
    print(f"wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
