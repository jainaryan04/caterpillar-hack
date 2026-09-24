"""Run Depth Anything V2 over an image, a folder, or a glob.

    python scripts/run_image.py inputs/site.avif
    python scripts/run_image.py inputs/ --encoder vitb --outdir out
    python scripts/run_image.py 'frames/*.jpg' --no-npy --no-side-by-side
"""

from __future__ import annotations

import argparse
import glob
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "depth"))

import cv2  # noqa: E402
import numpy as np  # noqa: E402

import colorize  # noqa: E402
from model import MODEL_CONFIGS, DepthEstimator  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
# cv2.imread handles all of these on OpenCV 4.13, avif included.
SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".avif", ".tif", ".tiff"}


def collect(target: str) -> list[pathlib.Path]:
    """A file, a directory, or a glob -> a sorted list of images."""
    path = pathlib.Path(target).expanduser()
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(p for p in path.iterdir() if p.suffix.lower() in SUFFIXES)
    hits = sorted(pathlib.Path(p) for p in glob.glob(str(path)))
    return [p for p in hits if p.suffix.lower() in SUFFIXES]


def main() -> int:
    ap = argparse.ArgumentParser(description="Depth Anything V2 image inference")
    ap.add_argument("img_path", help="image file, directory, or glob")
    ap.add_argument("--encoder", default="vitb", choices=list(MODEL_CONFIGS))
    ap.add_argument("--checkpoint", default=None,
                    help="path to the .pth (default: models/, then the DAv2 checkpoints/)")
    ap.add_argument("--input-size", type=int, default=518,
                    help="longest-side resize before the network (default 518)")
    ap.add_argument("--outdir", default=str(ROOT / "out"))
    ap.add_argument("--device", default=None, choices=["cuda", "mps", "cpu"])
    ap.add_argument("--cmap", default="Spectral_r", help="any matplotlib colormap")
    ap.add_argument("--no-npy", action="store_true", help="skip the raw float32 map")
    ap.add_argument("--no-gray", action="store_true")
    ap.add_argument("--no-color", action="store_true")
    ap.add_argument("--no-side-by-side", action="store_true")
    args = ap.parse_args()

    images = collect(args.img_path)
    if not images:
        print(f"no images matched {args.img_path!r}", file=sys.stderr)
        return 1

    try:
        est = DepthEstimator(
            encoder=args.encoder,
            checkpoint=args.checkpoint,
            device=args.device,
            input_size=args.input_size,
        )
    except FileNotFoundError as exc:
        # Missing checkout or checkpoint: the message says how to fix it, and
        # a traceback would only bury it.
        print(exc, file=sys.stderr)
        return 1
    print(f"{args.encoder} on {est.device}  <-  {est.checkpoint.name}")

    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    failures = 0
    for image_path in images:
        bgr = cv2.imread(str(image_path))
        if bgr is None:
            print(f"  skip {image_path.name}: cv2 could not read it", file=sys.stderr)
            failures += 1
            continue

        t0 = time.perf_counter()
        depth = est.infer(bgr)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        stem = image_path.stem
        written = []
        if not args.no_npy:
            np.save(outdir / f"{stem}_depth_raw.npy", depth)
            written.append("npy")
        if not args.no_gray:
            cv2.imwrite(str(outdir / f"{stem}_depth_gray.png"),
                        colorize.to_grayscale(depth))
            written.append("gray")

        color = None
        if not (args.no_color and args.no_side_by_side):
            color = colorize.to_color(depth, args.cmap)
        if not args.no_color:
            cv2.imwrite(str(outdir / f"{stem}_depth_color.png"), color)
            written.append("color")
        if not args.no_side_by_side:
            cv2.imwrite(str(outdir / f"{stem}_side_by_side.png"),
                        colorize.side_by_side(bgr, color))
            written.append("side-by-side")

        h, w = depth.shape
        print(f"  {image_path.name:<28} {w}x{h}  {elapsed_ms:6.0f} ms  "
              f"range {depth.min():.2f}-{depth.max():.2f}  [{', '.join(written)}]")

    print(f"wrote {len(images) - failures}/{len(images)} to {outdir}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
