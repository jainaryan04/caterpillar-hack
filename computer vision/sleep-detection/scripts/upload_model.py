"""Push the YOLO face checkpoint into the Modal Volume the app reads from.

    python scripts/upload_model.py ~/Downloads/yolov12m-face.pt

Equivalent to:
    modal volume put sleep-detection-models <file> yolov12m-face.pt
"""

from __future__ import annotations

import argparse
import pathlib
import sys

import modal

VOLUME = "sleep-detection-models"
REMOTE_NAME = "yolov12m-face.pt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?",
                    default=str(pathlib.Path.home() / "Downloads" / REMOTE_NAME))
    args = ap.parse_args()

    src = pathlib.Path(args.path).expanduser()
    if not src.exists():
        sys.exit(f"{src} not found")

    vol = modal.Volume.from_name(VOLUME, create_if_missing=True)
    size_mb = src.stat().st_size / 1e6
    print(f"uploading {src} ({size_mb:.1f} MB) -> volume '{VOLUME}' as {REMOTE_NAME}")
    with vol.batch_upload(force=True) as batch:
        batch.put_file(str(src), f"/{REMOTE_NAME}")
    print("done. contents:")
    for entry in vol.listdir("/"):
        print(f"  {entry.path}  {entry.size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
