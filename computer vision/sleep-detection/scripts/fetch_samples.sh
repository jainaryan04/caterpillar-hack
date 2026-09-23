#!/usr/bin/env bash
# Download the test clips used in the README.
#
# Source: Pexels, free for personal and commercial use, no attribution
# required (https://www.pexels.com/license/). Kept out of git because they
# are large binaries -- rerun this to get them back.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/samples"
mkdir -p "$DIR"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"

fetch() {  # id  output_basename  description
  local id="$1" name="$2" desc="$3"
  if [[ -f "$DIR/${name}_720p.mp4" ]]; then
    echo "have  ${name}_720p.mp4"
    return
  fi
  echo "fetch $name  ($desc)"
  curl -fsSL -A "$UA" -o "$DIR/_raw_$id.mp4" \
    "https://www.pexels.com/download/video/$id/"
  ffmpeg -v error -i "$DIR/_raw_$id.mp4" -vf scale=1280:-2 \
    -c:v libx264 -crf 23 -preset veryfast -an -y "$DIR/${name}_720p.mp4"
  if [[ "${KEEP_ORIGINAL:-0}" == "1" ]]; then
    mv "$DIR/_raw_$id.mp4" "$DIR/$name.mp4"
  else
    rm -f "$DIR/_raw_$id.mp4"
  fi
}

# Primary: night drive, face well framed, eyes visibly drooping early on.
fetch 9531464 tired_driver   "tired man driving at night, 34s"
# Hard case: same actor, face small and partly hidden behind the wheel.
fetch 9530761 distant_driver "distant driver, small face, 35s"
# Positive case: a real sustained eye closure, plus glasses and a hand occlusion.
fetch 7033439 yawning_woman  "woman yawning, 10s"

echo
ls -la "$DIR"
