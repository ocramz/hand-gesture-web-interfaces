#!/usr/bin/env bash
# Downloads the YOLO26s hand-pose ONNX weights (poptoz/yolo26-hand-pose-face-detection on Hugging Face)
# into assets/models/. License: AGPL-3.0 (Ultralytics base model) + CC BY-NC-SA 4.0 (Hand Keypoints
# dataset), i.e. non-commercial use.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/models
base="https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/resolve/main/models"
for f in yolo26_hand_pose_fp16.onnx yolo26_hand_pose_fp32.onnx; do
  if [ -s "assets/models/$f" ]; then echo "have $f"; continue; fi
  echo "fetching $f"
  curl -fL --retry 3 -o "assets/models/$f.part" "$base/$f"
  mv "assets/models/$f.part" "assets/models/$f"
done
ls -lh assets/models
