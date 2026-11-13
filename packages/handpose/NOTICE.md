# Notice

`@ocramz/handpose` is licensed under the GNU Affero General Public License v3.0 only (see `LICENSE`).

## Bundled model weights

`assets/models/yolo26_hand_pose_fp16.onnx` and `assets/models/yolo26_hand_pose_fp32.onnx` are the
YOLO26s hand-pose weights from
[poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection),
redistributed unmodified:

- base model: YOLO26s-pose by Ultralytics, **AGPL-3.0**;
- fine-tuned on the Ultralytics Hand Keypoints dataset, **CC BY-NC-SA 4.0**.

The weights may therefore only be used **non-commercially**, with attribution, and derivatives shared under
the same terms. Using this package in a product means accepting those terms, whatever else your code is
licensed under.

## Third-party runtime code

- [onnxruntime-web](https://github.com/microsoft/onnxruntime) (MIT) is a dependency, installed from npm.
- `tract/pkg/` is compiled from this repository's Rust crate, which statically links
  [tract](https://github.com/sonos/tract) (MIT OR Apache-2.0) and its dependencies.
