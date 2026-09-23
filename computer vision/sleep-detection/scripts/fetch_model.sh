#!/usr/bin/env bash
# Download the MediaPipe FaceLandmarker model (~3.7 MB) into models/.
# Kept out of git as a build artifact.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models"
URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

mkdir -p "$DIR"
if [[ -f "$DIR/face_landmarker.task" ]]; then
  echo "have  models/face_landmarker.task"
else
  echo "fetch models/face_landmarker.task"
  curl -fsSL -o "$DIR/face_landmarker.task" "$URL"
fi
ls -la "$DIR"
