"""Run the deployed construction-equipment model over HTTP.

    export ULTRALYTICS_API_KEY=ul_...

    python scripts/run_remote.py --info                  # what is deployed
    python scripts/run_remote.py inputs/site.avif        # one image
    python scripts/run_remote.py inputs/                 # a folder
    python scripts/run_remote.py https://ultralytics.com/images/bus.jpg
    python scripts/run_remote.py inputs/site.avif --conf 0.1 --imgsz 1280

Writes `<stem>_equip.png` (boxes drawn) and `<stem>_equip.json` (raw endpoint
response plus the parsed detections) to `out/`.

This is the detector half only -- no depth. To fuse the two, hand a
`RemoteDetector` to the proximity scorer the way `run_alert.py` hands it a
local `Detector`; the interfaces match.
"""

from __future__ import annotations

import argparse
import glob
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "depth"))

import cv2  # noqa: E402

from remote import DEFAULT_ENDPOINT, RemoteDetector, RemoteError  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
IMAGE_SUFFIXES = {".avif", ".bmp", ".dng", ".heic", ".jp2", ".jpeg", ".jpg",
                  ".mpo", ".png", ".tif", ".tiff", ".webp"}

# Distinct-ish colours cycled per class, so one class keeps one colour across
# a run. BGR.
PALETTE = [(80, 180, 255), (90, 220, 140), (240, 160, 70), (120, 120, 250),
           (220, 200, 90), (200, 120, 240), (110, 230, 230), (160, 160, 160)]


def colour_for(label: str, seen: dict[str, tuple]) -> tuple:
    if label not in seen:
        seen[label] = PALETTE[len(seen) % len(PALETTE)]
    return seen[label]


def annotate(frame, dets, seen):
    out = frame.copy()
    h, w = out.shape[:2]
    scale = max(0.4, min(w, h) / 1400)
    thick = max(1, int(round(scale * 3)))

    for d in dets:
        x1, y1, x2, y2 = d.box
        colour = colour_for(d.label, seen)
        cv2.rectangle(out, (x1, y1), (x2, y2), colour, thick)
        tag = f"{d.label} {d.confidence:.2f}"
        (tw, th), _ = cv2.getTextSize(tag, cv2.FONT_HERSHEY_SIMPLEX, scale * 0.8, thick)
        ty = max(0, y1 - th - 4)
        cv2.rectangle(out, (x1, ty), (x1 + tw + 6, ty + th + 6), colour, -1)
        cv2.putText(out, tag, (x1 + 3, ty + th + 1), cv2.FONT_HERSHEY_SIMPLEX,
                    scale * 0.8, (20, 20, 20), thick)
    return out


def collect(target: str) -> list[pathlib.Path]:
    p = pathlib.Path(target).expanduser()
    if p.is_dir():
        return sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_SUFFIXES)
    if p.is_file():
        return [p]
    hits = [pathlib.Path(h) for h in sorted(glob.glob(target))]
    return [h for h in hits if h.suffix.lower() in IMAGE_SUFFIXES]


def report(name: str, dets, speed: dict, wall: float) -> None:
    ms = ", ".join(f"{k} {v:.1f}ms" for k, v in speed.items()) if speed else "-"
    print(f"\n{name}: {len(dets)} detection(s)   [{ms}; {wall * 1000:.0f}ms round trip]")
    for d in sorted(dets, key=lambda d: -d.confidence):
        x1, y1, x2, y2 = d.box
        print(f"  {d.confidence:5.2f}  {d.label:<24} {d.kind:<8} "
              f"({x1},{y1})-({x2},{y2})  {d.width}x{d.height}px")
    if not dets:
        print("  nothing above the confidence threshold -- try --conf 0.05")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?", help="image file, folder, glob, or image URL")
    ap.add_argument("--info", action="store_true", help="print deployment info and exit")
    ap.add_argument("--endpoint", default=None, help=f"default: {DEFAULT_ENDPOINT}")
    ap.add_argument("--api-key", default=None, help="else $ULTRALYTICS_API_KEY")
    ap.add_argument("--conf", type=float, default=0.25, help="0.01-1.0")
    ap.add_argument("--iou", type=float, default=0.7, help="NMS IoU, 0-0.95")
    ap.add_argument("--imgsz", type=int, default=640, help="32-1280")
    ap.add_argument("--timeout", type=float, default=120.0)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--strict-classes", action="store_true",
                    help="drop labels that are not COCO person/vehicle names "
                         "instead of treating them as machinery")
    ap.add_argument("--outdir", default=str(ROOT / "out"))
    ap.add_argument("--no-image", action="store_true", help="skip the annotated PNG")
    ap.add_argument("--no-json", action="store_true")
    args = ap.parse_args()

    if not args.info and not args.source:
        ap.error("give a source, or --info")

    try:
        det = RemoteDetector(endpoint=args.endpoint, api_key=args.api_key,
                             conf=args.conf, iou=args.iou, imgsz=args.imgsz,
                             timeout=args.timeout, retries=args.retries,
                             unknown_kind=None if args.strict_classes else "vehicle")
    except (RemoteError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1

    if args.info:
        try:
            info = det.health()
        except RemoteError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(json.dumps({k: v for k, v in info.items() if k != "help"}, indent=2))
        return 0

    outdir = pathlib.Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    seen_colours: dict[str, tuple] = {}

    # A URL goes straight to the endpoint -- it fetches the image itself, so
    # there is nothing local to draw on.
    if args.source.startswith(("http://", "https://")):
        t0 = time.perf_counter()
        try:
            payload = det.predict_source(args.source)
        except RemoteError as exc:
            print(exc, file=sys.stderr)
            return 1
        dets = det.parse(payload)
        report(args.source, dets, det.last_speed, time.perf_counter() - t0)
        if not args.no_json:
            path = outdir / "url_equip.json"
            path.write_text(json.dumps(
                {"source": args.source, "response": payload,
                 "detections": [d.__dict__ | {"box": list(d.box)} for d in dets]},
                indent=2))
            print(f"wrote {path}")
        return 0

    paths = collect(args.source)
    if not paths:
        print(f"no images matched {args.source}", file=sys.stderr)
        return 1

    failures = 0
    for path in paths:
        t0 = time.perf_counter()
        try:
            payload = det.predict_file(path)
        except RemoteError as exc:
            print(f"{path.name}: {exc}", file=sys.stderr)
            failures += 1
            continue
        wall = time.perf_counter() - t0
        dets = det.parse(payload)
        report(path.name, dets, det.last_speed, wall)

        if not args.no_json:
            jpath = outdir / f"{path.stem}_equip.json"
            jpath.write_text(json.dumps(
                {"source": str(path), "response": payload,
                 "detections": [d.__dict__ | {"box": list(d.box)} for d in dets]},
                indent=2))
            print(f"  wrote {jpath}")

        if not args.no_image:
            frame = cv2.imread(str(path))
            if frame is None:
                print(f"  cv2 could not read {path} -- skipping the PNG", file=sys.stderr)
                continue
            ipath = outdir / f"{path.stem}_equip.png"
            cv2.imwrite(str(ipath), annotate(frame, dets, seen_colours))
            print(f"  wrote {ipath}")

    if det.names:
        print(f"\nclasses seen this run: {', '.join(sorted(det.names))}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
