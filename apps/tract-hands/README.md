# Tract Hands

A demo of the tract engine of [`@ocramz/handpose`](../../packages/handpose): the webcam's hand keypoints
as thick spheres joined by cylinders, overlaid on the video. The hand-pose vision pipeline (YOLO26, decoding,
tracking) runs in [tract](https://github.com/sonos/tract), compiled to wasm, on WebGPU.

```sh
npm run dev:tract   # from the repo root: builds the wasm, then http://localhost:5173, allow the camera
```

URL parameters: `?image=/samples/two_hands.jpg` runs on a still image instead of the webcam, `mirror=0|1`,
`engine=tract|ort` (onnxruntime-web, to compare), `backend=webgpu|wasm`, `precision=fp16|fp32`, `debug=1`
(the raw detections in 2D over the skeletons).

Each keypoint is placed at its 3D point from `HandView.point`: on its pixel, at the depth the palm's
apparent size gives (`src/skeleton.ts`).
