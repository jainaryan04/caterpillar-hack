"""Push the PPE checkpoint into the Modal Volume the app reads from.

    python scripts/upload_model.py ~/Downloads/yolov12m-builder.pt
"""

import argparse
import pathlib
import sys

import modal

VOLUME = "site-safety-models"
REMOTE = "yolov12m-builder.pt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path", nargs="?",
                    default=str(pathlib.Path.home() / "Downloads" / REMOTE))
    args = ap.parse_args()
    src = pathlib.Path(args.path).expanduser()
    if not src.exists():
        sys.exit(f"{src} not found")

    vol = modal.Volume.from_name(VOLUME, create_if_missing=True)
    print(f"uploading {src} ({src.stat().st_size/1e6:.1f} MB) -> {VOLUME}/{REMOTE}")
    with vol.batch_upload(force=True) as batch:
        batch.put_file(str(src), f"/{REMOTE}")
    for e in vol.listdir("/"):
        print(f"  {e.path}  {e.size/1e6:.1f} MB")


if __name__ == "__main__":
    main()
