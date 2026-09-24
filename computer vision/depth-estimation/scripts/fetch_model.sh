#!/usr/bin/env bash
# Download a Depth Anything V2 checkpoint into models/.
# Kept out of git as a build artifact.
#
#   ./scripts/fetch_model.sh          # vitb, 372 MB -- the default
#   ./scripts/fetch_model.sh vits     # 99 MB, fastest
#   ./scripts/fetch_model.sh vitl     # 1.3 GB, best quality
set -euo pipefail

ENCODER="${1:-vitb}"
case "$ENCODER" in
  vits) REPO="Depth-Anything-V2-Small" ;;
  vitb) REPO="Depth-Anything-V2-Base"  ;;
  vitl) REPO="Depth-Anything-V2-Large" ;;
  *) echo "unknown encoder '$ENCODER' (vits|vitb|vitl)" >&2; exit 1 ;;
esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models"
FILE="depth_anything_v2_${ENCODER}.pth"
URL="https://huggingface.co/depth-anything/${REPO}/resolve/main/${FILE}?download=true"

mkdir -p "$DIR"
if [[ -f "$DIR/$FILE" ]]; then
  echo "have  models/$FILE"
else
  echo "fetch models/$FILE  (from $REPO)"
  curl -fL --progress-bar -o "$DIR/$FILE.part" "$URL"
  mv "$DIR/$FILE.part" "$DIR/$FILE"   # only rename once complete
fi
ls -lh "$DIR"
