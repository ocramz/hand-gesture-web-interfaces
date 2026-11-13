# @ocramz/handpose

Hand pose from the webcam, in the browser: a YOLO26 hand-pose model in onnxruntime-web or in
[tract](https://github.com/sonos/tract) compiled to wasm (in a worker), two stable tracked hands, and their
keypoints lifted to 3D camera space. Plus a three.js stage that shows
the camera frame with a matched 3D camera, so anything placed at a hand's 3D position lands on its pixels.

Chrome or Safari with WebGPU: the model runs on the GPU (fp16). Without usable WebGPU it falls back to
multithreaded WASM (fp32), at a few frames per second.

## Engines

`new HandPose({ engine })` picks what runs the model:

- **`ort`** (default): onnxruntime-web. The worker letterboxes, runs the model and decodes; tracking runs
  on the main thread (`HandTracker`).
- **`tract`**: the whole vision pipeline in Rust, compiled to wasm (`tract/`). The worker only draws the
  frame onto a 640² canvas. tract uploads and normalizes it on the GPU (`Tensor::from_canvas_normalized`),
  runs YOLO26 on its `wgpu` runtime, then decodes, canonicalizes and tracks the hands, and the worker posts
  the two tracked slots back. Without WebGPU it runs on tract's CPU runtime: wasm simd128 on one thread,
  about 0.7 s per frame.

  The graph is cut just before its end-to-end selection (TopK, GatherElements on the head's 8400 anchors):
  tract's WebGPU runtime has no kernels for those ops, and in a browser it cannot hand them to the CPU in
  the middle of a graph. `top_detections` in `tract/src/decode.rs` does the selection instead, and
  `tests/native.rs` checks that it gives exactly the rows of the uncut graph's `output0`.

  Firefox finishes WebGPU readbacks on a 100 ms timer. The three outputs are downloaded at once, and
  while they are pending the worker submits empty command lists to make Firefox check sooner
  (`src/pose/firefoxPoll.ts`). Without that, a frame took about 350 ms on Firefox instead of about 85 ms.

`tract/src/decode.rs` and `tract/src/tracker.rs` are ports of `src/pose/decode.ts` and `src/pose/tracker.ts`
(the ORT path still uses those): change both together.

Building the tract engine needs Rust with the wasm target and the wasm-bindgen CLI that `tract/Cargo.lock`
pins. `npm run dev`, `build` and `typecheck` at the repo root build it first (`npm run build:wasm`).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.128 --locked
```

## Use

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { handpose } from '@ocramz/handpose/vite'
export default defineConfig({ plugins: [handpose()] })
```

The plugin turns on cross-origin isolation (threaded WASM), keeps onnxruntime-web out of pre-bundling, and
serves the model weights at `<base>models/` and the sample images at `<base>samples/` (copied into the build).

```ts
import { HandPose, KP, openWebcam, Stage } from '@ocramz/handpose'

const source = await openWebcam() // or openImage('/samples/two_hands.jpg')
const stage = new Stage({ canvas, overlay, source, mirror: true, hfovDeg: 60 })
const pose = new HandPose({ onFatal: console.error })
let last = performance.now() / 1000
stage.renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000
  const dt = Math.min(0.1, now - last)
  last = now
  pose.pump(now, source, true) // feeds the model when it is idle
  pose.updateViews(dt, stage.cam) // pose.views[0|1]: active, kp (pixels), depth, rays, point(k, out)
  stage.render()
})
```

| Piece | Where |
|---|---|
| Frame → 640² letterbox → model → hands (end-to-end output `[1, 300, 69]`, no NMS) | `src/pose/worker.ts`, `src/pose/decode.ts` |
| The same in tract, with tracking: Rust pipeline and its wasm API, worker, result unpacking | `tract/src/`, `src/pose/tractWorker.ts`, `src/pose/packed.ts` |
| Worker client: init, frame pumping, timings | `src/pose/client.ts` (`HandPose`) |
| Keypoint order repair (see below) | `canonicalize` in `src/pose/decode.ts` |
| Two stable hand slots, hysteresis, One-Euro smoothing | `src/pose/tracker.ts`, `src/hands.ts` |
| Webcam / still-image frame sources | `src/source.ts` |
| Pinhole camera, cover-fit to the canvas | `src/camera.ts` |
| 2D → 3D: hand depth from palm size; rays onto a plane through the hand | `src/lift.ts` |
| three.js stage: renderer, video background, matched camera, debug overlay | `src/stage.ts`, `src/render/` |

**Depth.** The model gives 2D keypoints only. A hand's distance comes from its apparent palm size
(`handDepth`); the camera's horizontal fov and a hand-size factor calibrate it. Points a shape needs are put
on a plane through the hand (`raysOnPlane`), so each 3D point stays exactly on its pixel. `ringNormal`
picks a plane that faces the other hand, tipped toward the camera, and never closer than a set angle to
edge-on, where the rays would graze it.

**Keypoint order.** The model does not always use one keypoint order. On some images it emits
MediaPipe's documented order; on others (even a mirrored copy of the same photo) it emits a permutation:
thumb IP ↔ tip, and indices 5–9 ↔ 10–14. That permutation is exactly a training-time `flip_idx` of
`[0,1,2,4,3,10..14,5..9,15..20]`. `canonicalize` picks, separately for the thumb and the fingers,
whichever reading gives the shorter skeleton.

## Model

`npm run fetch-model` downloads the weights (21 MB fp16 + 43 MB fp32) into `assets/models/` if missing.
They are [poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection):
YOLO26s-pose (Ultralytics, AGPL-3.0) fine-tuned on Ultralytics Hand Keypoints (CC BY-NC-SA 4.0). Use them
non-commercially. `assets/samples/two_hands.jpg` is the public-domain Wikimedia Commons photo
"Two hand, ten fingers.jpg"; `hands_apart.jpg` is cut from it.

## Checks

```sh
npm test            # decode, lift, tracker (TS); then cargo test: the Rust ports and the real model on the samples
npm run typecheck   # from the repo root, which builds the wasm bindings it type-checks against
```
