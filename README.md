# Soap Hands

Hold a soap film between your hands. The webcam's hands are tracked by a YOLO26 hand-pose model running
in the browser (onnxruntime-web, in a worker); three.js renders an iridescent minimal surface whose
boundary is held by your fingertips.

```sh
npm install
npm run fetch-model   # downloads the hand-pose ONNX weights (21 MB fp16 + 43 MB fp32) into public/models
npm run dev           # http://localhost:5173 — allow the camera
```

Chrome or Safari with WebGPU: the model runs on the GPU (fp16). Without usable WebGPU it falls back to
multithreaded WASM (fp32), at a few frames per second.

## Shapes

- **Rings** (key `1`): a ring through three fingertips of each hand (thumb, index and middle by default)
  and the catenoid film between the two rings. Pull your hands apart past the catenoid's stability limit
  (rings of radius R pop at about 1.33 R apart) and the film bursts: droplets, a flat disc on each ring
  and a free bubble that floats off. Poke the bubble with a fingertip to pop it. Bring the two discs
  together and the catenoid re-forms. One hand alone holds a disc, like a bubble wand.
- **Saddle** (key `2`): thumb tip → index tip is a wire on each hand; the film spans the skew
  quadrilateral the two wires make, with free edges bowing inward. Twist your hands against each other.

`D` toggles the debug overlay (raw detections, tracked keypoints, hand depth). The panel has the shape,
film and camera settings.

URL parameters: `?image=/samples/two_hands.jpg` runs on a still image instead of the webcam,
`mirror=0|1`, `backend=webgpu|wasm`, `precision=fp16|fp32`, `mode=rings|saddle`, `debug=1`, `gui=0`.

## How it works

| Step | Where |
|---|---|
| Frame → 640² letterbox → model → hands (end-to-end output `[1, 300, 69]`, no NMS) | `src/pose/worker.ts`, `src/pose/decode.ts` |
| Keypoint order repair (see below) | `canonicalize` in `src/pose/decode.ts` |
| Two stable hand slots, hysteresis, One-Euro smoothing | `src/pose/tracker.ts`, `src/hands.ts` |
| 2D → 3D: hand depth from palm size; fingertip rays intersected with a plane through the hand | `src/geom/lift.ts`, `src/geom/camera.ts` |
| Catenoid between rings of radii R1, R2 at distance h, and its stability limit | `src/geom/catenoid.ts` |
| Surface: analytic start (catenoid / Coons patch), then area-minimising relaxation | `src/geom/grids.ts`, `src/geom/relax.ts` |
| Thin-film interference shader, bubbles, droplets | `src/render/` |
| Shapes and the pop state machine | `src/modes/` |

**Depth.** The model gives 2D keypoints only. Rings that faced the camera would sit side by side in
one plane, and no film can span them. So each ring's plane is chosen: it faces the other hand, tipped
toward the camera by *tilt to camera*, and never closer than about 75° to edge-on. Each fingertip's
camera ray is intersected with that plane, so the 3D ring passes exactly through the fingertips you see.
A hand's distance comes from its apparent palm size; *webcam h-fov* and *hand size* calibrate it.
When the three tips are nearly in a line, their circumcircle explodes, so the ring blends toward a
circle around their centroid.

**Keypoint order.** The model does not always use one keypoint order. On some images it emits
MediaPipe's documented order; on others (even a mirrored copy of the same photo) it emits a permutation:
thumb IP ↔ tip, and indices 5–9 ↔ 10–14. That permutation is exactly a training-time `flip_idx` of
`[0,1,2,4,3,10..14,5..9,15..20]`. `canonicalize` picks, separately for the thumb and the fingers,
whichever reading gives the shorter skeleton.

## Fixed vs variable number of fingers

| | Fixed (e.g. thumb, index, middle) | Variable (every confident fingertip) |
|---|---|---|
| Boundary topology | Constant: one mesh, allocated once | Changes as fingers come and go; fewer than 3 tips can't close a loop |
| Math | 3 points define one circle: analytic catenoid, exact pop criterion | Non-planar polygon: a general Plateau solve every frame |
| Stability | High | Per-finger confidence flickers on curled or hidden fingers |
| Expressiveness | Two fingers per hand ignored | Curling a finger reshapes the film |
| Occlusion | One hidden tip breaks the fit (held briefly) | Degrades, at the cost of a topology change |

The middle path, *fixed topology with variable influence*, is the natural next step: always 5 slots
per hand in anatomical order, with a low-confidence tip slid onto the circle through the confident ones
over about 150 ms. It looks variable while the mesh stays fixed.

## More variations (not built yet)

- **Single-hand wand**: a loop through one hand's 5 tips (the hybrid above), a non-planar Plateau surface.
- **Ten-finger sail**: one loop through all 10 tips, a large saddle between the hands.
- **Pinch-O rings**: each ring is the "OK" loop (thumb tip, index tip, thumb IP, index DIP).
- **Free-edge sail**: the saddle's connecting edges as free boundaries under line tension (circular arcs).
- **Bubble chain**: a pinch blows a bubble off the film; bubbles cluster with Plateau's 120° junctions.

## Checks

```sh
npm test         # decode, lift, catenoid, relaxation, tracker, ring-mode state machine
npm run typecheck
npm run build
```

## Licences

The hand-pose weights are [poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection):
YOLO26s-pose (Ultralytics, AGPL-3.0) fine-tuned on Ultralytics Hand Keypoints (CC BY-NC-SA 4.0). Use them
non-commercially. `public/samples/two_hands.jpg` is the public-domain Wikimedia Commons photo
"Two hand, ten fingers.jpg"; `hands_apart.jpg` is cut from it.
