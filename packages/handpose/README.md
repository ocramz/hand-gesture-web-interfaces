# @ocramz/handpose

Hand pose from the webcam, in the browser: a YOLO26 hand-pose model in onnxruntime-web (in a worker),
two stable tracked hands, and their keypoints lifted to 3D camera space. Plus a three.js stage that shows
the camera frame with a matched 3D camera, so anything placed at a hand's 3D position lands on its pixels.

Chrome or Safari with WebGPU: the model runs on the GPU (fp16). Without usable WebGPU it falls back to
multithreaded WASM (fp32), at a few frames per second.

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
npm test            # decode, lift, tracker
npm run typecheck
```
