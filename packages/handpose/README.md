# @ocramz/handpose

Hand pose from the webcam, in the browser: a YOLO26 hand-pose model in onnxruntime-web or in
[tract](https://github.com/sonos/tract) compiled to wasm (in a worker), two stable tracked hands, and their
keypoints lifted to 3D camera space. Prebuilt: compiled JS + types, the tract wasm and the model weights are
all in the package. No rendering framework: `three` or anything else is up to the app (a three.js `Vector3`
can be passed wherever the API takes a `Vec3`).

```sh
npm install @ocramz/handpose
```

**License: AGPL-3.0-only. The bundled weights are non-commercial** (see [Model](#model) and `NOTICE.md`).

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

Needs an ESM bundler that understands `new URL('…', import.meta.url)` and module workers (Vite, webpack 5,
…): the package finds its workers, the tract `.wasm` and the `.onnx` weights that way, and the bundler emits
them as assets. With Vite:

```ts
// vite.config.ts
import { defineConfig } from 'vite'

// Cross-origin isolation lets onnxruntime-web's WASM backend use threads (SharedArrayBuffer).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  // Pre-bundling would move the modules away from the files they locate through import.meta.url.
  optimizeDeps: { exclude: ['@ocramz/handpose', 'onnxruntime-web'] },
  worker: { format: 'es' },
})
```

Serve the same two headers in production for threaded WASM (without them it runs on one thread).

```ts
import { CameraModel, HandPose, KP, openWebcam, vec3 } from '@ocramz/handpose'

const source = await openWebcam() // or openImage(url)
const cam = new CameraModel()
cam.set(source.width, source.height, 60 /* webcam horizontal fov, degrees */, true /* mirror */)
const pose = new HandPose({ engine: 'ort', onFatal: console.error }) // or engine: 'tract'
const tip = vec3()
let last = performance.now() / 1000
function frame() {
  const now = performance.now() / 1000
  pose.pump(now, source, true) // feeds the model when it is idle
  pose.updateViews(Math.min(0.1, now - last), cam)
  last = now
  for (const hand of pose.views) {
    if (hand.active) hand.point(KP.indexTip, tip) // metres, camera space: x right, y up, looking down −z
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
```

`pose.views[0|1]`: `active`, `presence`, `kp` (smoothed keypoints, source pixels), `depth`, `rays`,
`point(k, out)`. `pose.raw`: the latest detections. `pose.statusLine()`: backend, model time, pose rate.
`drawDebug(ctx, cam, pose.raw, pose.views, dpr)` draws them on a 2D canvas.

The weights default to the copies in the package. To host them elsewhere (a CDN), copy
`@ocramz/handpose/models/yolo26_hand_pose_{fp16,fp32}.onnx` there and pass
`new HandPose({ modelUrls: { fp16, fp32 } })`.

| Piece | Where |
|---|---|
| Frame → 640² letterbox → model → hands (end-to-end output `[1, 300, 69]`, no NMS) | `src/pose/worker.ts`, `src/pose/decode.ts` |
| The same in tract, with tracking: Rust pipeline and its wasm API, worker, result unpacking | `tract/src/`, `src/pose/tractWorker.ts`, `src/pose/packed.ts` |
| Worker client: init, frame pumping, timings | `src/pose/client.ts` (`HandPose`) |
| Keypoint order repair (see below) | `canonicalize` in `src/pose/decode.ts` |
| Two stable hand slots, hysteresis, One-Euro smoothing | `src/pose/tracker.ts`, `src/hands.ts` |
| Webcam / still-image frame sources | `src/source.ts` |
| Pinhole camera, cover-fit to a canvas | `src/camera.ts` |
| 2D → 3D: hand depth from palm size; rays onto a plane through the hand | `src/lift.ts` |
| Debug overlay (2D canvas) | `src/render/debugOverlay.ts` |
| Minimal `{x, y, z}` vector helpers | `src/vec3.ts` |

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

The package includes the weights (21 MB fp16 for WebGPU + 43 MB fp32 for WASM, in `assets/models/`):
[poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection):
YOLO26s-pose (Ultralytics, AGPL-3.0) fine-tuned on Ultralytics Hand Keypoints (CC BY-NC-SA 4.0). Use them
non-commercially. In this repo `npm run fetch-model` re-downloads them if missing.
`assets/samples/two_hands.jpg` (repo only, not published) is the public-domain Wikimedia Commons photo
"Two hand, ten fingers.jpg"; `hands_apart.jpg` is cut from it.

## Building from source

`npm run build` (here or at the repo root) builds the tract wasm (`build:wasm`) and compiles `src/` into
`dist/` (`build:ts`, plain `tsc`, file for file, so the worker, wasm and model URLs stay relative). The apps
in this repo import the built `dist/` like any npm user; run `npm run watch` while changing the library.

## Checks

```sh
npm test            # decode, lift, tracker (TS); then cargo test: the Rust ports and the real model on the samples
npm run typecheck   # from the repo root, which builds the package first
bash test-consumer/run-smoke.sh <ocramz-handpose-X.Y.Z.tgz>   # the packed tarball in a fresh Vite app, both engines, headless Chromium
```
