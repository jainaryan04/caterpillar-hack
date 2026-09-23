"""Download demo footage for the safety demo.

Every URL here was verified to return HTTP 200 from the Pexels CDN. Pexels content is
free for commercial use with no attribution required, which keeps the demo clean.

Driver-facing footage is a different story - see the note at the bottom of this file.
"""

import argparse
import os
import sys
import urllib.request

MEDIA_DIR = "media"

CLIPS = {
    # Ground-level, workers visible walking through the scene. Best proximity demo.
    "front_workers.mp4": (
        "https://videos.pexels.com/video-files/9227135/9227135-hd_1920_1080_30fps.mp4",
        "Construction workers walking at a site — people at varying depths",
    ),
    # Excavator moving material. Machinery class + dirt piles for obstacle detection.
    "front_excavator.mp4": (
        "https://videos.pexels.com/video-files/11839348/11839348-hd_1280_720_30fps.mp4",
        "Excavator working on a construction site — machinery and spoil heaps",
    ),
    # Busy site, multiple people and structures. Good for a crowded radar.
    "site_builders.mp4": (
        "https://videos.pexels.com/video-files/10810481/10810481-hd_1920_1080_30fps.mp4",
        "Builders on an active construction site — several workers at once",
    ),
    # Wide site shot, useful as a third camera or B-roll in the pitch.
    "site_wide.mp4": (
        "https://videos.pexels.com/video-files/856439/856439-hd_1920_1080_25fps.mp4",
        "Wide construction site — background plate",
    ),
}

UA = {"User-Agent": "Mozilla/5.0 (compatible; cat-operator-assistant/1.0)"}


def download(name, url, description, force=False):
    os.makedirs(MEDIA_DIR, exist_ok=True)
    path = os.path.join(MEDIA_DIR, name)
    if os.path.exists(path) and not force:
        print(f"  skip   {name} (exists, {os.path.getsize(path) / 1e6:.1f} MB)")
        return path
    print(f"  fetch  {name} — {description}")
    request = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(request, timeout=120) as response, open(path, "wb") as fh:
        fh.write(response.read())
    print(f"         done ({os.path.getsize(path) / 1e6:.1f} MB)")
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-download existing files")
    args = parser.parse_args()

    print(f"downloading {len(CLIPS)} clips into ./{MEDIA_DIR}/")
    failures = []
    for name, (url, description) in CLIPS.items():
        try:
            download(name, url, description, force=args.force)
        except Exception as exc:
            failures.append((name, exc))
            print(f"  FAIL   {name}: {exc}", file=sys.stderr)

    print(
        "\nDriver-facing footage is not downloaded automatically.\n"
        "  Best demo option: use your own webcam (--driver-source 0). Closing your eyes\n"
        "  on stage makes the fatigue alert fire live, which reads far better than a\n"
        "  video file, and there is no dataset to wrangle.\n"
        "  For accuracy numbers to quote, validate against UTA-RLDD:\n"
        "    https://www.kaggle.com/datasets/mathiasviborg/uta-rldd-videos-cropped-by-faces\n"
        "  (face-cropped, far smaller than the 111 GB original)"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
