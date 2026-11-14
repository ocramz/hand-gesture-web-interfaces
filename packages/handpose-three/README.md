# @ocramz/handpose-three (private)

three.js and Vite glue for the apps in this repo, kept out of the published `@ocramz/handpose`:

- `Stage`: a fullscreen three.js renderer over the camera frame. The video cover-fits the canvas as the
  background and the 3D camera's fov is matched to it, so a point in camera space lands on the pixel the
  webcam saw it at. `stage.cam` is the `CameraModel` to pass to `pose.updateViews`; `stage.texture` is the
  source as a three.js texture; `stage.drawDebug(raw, views)` draws on the overlay canvas.
- `sourceTexture(source)`, `createBackground(texture)`: the pieces `Stage` is made of.
- `@ocramz/handpose-three/vite`: `handpose()` turns on cross-origin isolation, keeps `onnxruntime-web` and
  `@ocramz/handpose` out of pre-bundling, and serves `packages/handpose/assets/samples/` at `<base>samples/`
  (copied into builds), for `?image=/samples/two_hands.jpg`.

```ts
import { HandPose, openWebcam } from '@ocramz/handpose'
import { Stage } from '@ocramz/handpose-three'

const source = await openWebcam()
const stage = new Stage({ canvas, overlay, source, mirror: true, hfovDeg: 60 })
const pose = new HandPose({ onFatal: console.error })
let last = performance.now() / 1000
stage.renderer.setAnimationLoop(() => {
  const now = performance.now() / 1000
  pose.pump(now, source, true)
  pose.updateViews(Math.min(0.1, now - last), stage.cam)
  last = now
  stage.render()
})
```

## Demo

[`demo/`](demo) is a tour of this package that builds to one static folder: 3D markers pinned to the
tracked hands (sized in metres, placed with `HandView.point`), and a panel that drives the API. It runs on
the webcam, mirrored, with a 60° horizontal fov.

```sh
npm run demo                                  # from the repo root: builds @ocramz/handpose, then http://localhost:5173
npm run demo:build -w @ocramz/handpose-three  # → packages/handpose-three/demo/dist/, about 105 MB
npm run demo:preview -w @ocramz/handpose-three
```

It is published at https://ocramz.github.io/hand-gesture-web-interfaces/ by `.github/workflows/pages.yml`.

| Panel | API |
|---|---|
| Background | `stage.background.setDim(d)`: live |
| Debug overlay (`D`) | the raw detections (`pose.raw`): boxes with their confidence, on top of the 3D markers |
| Engine, backend | `new HandPose({ engine, backend })`: reload the page |

The panel keeps its settings in the URL: `engine=tract|ort` (default `tract`), `backend=webgpu|auto|wasm`
(default `webgpu`; it falls back to wasm without a usable WebGPU adapter), `dim=0..1` (default `0.05`),
`debug=1`.

`dist/` holds everything the page loads: three.js, `@ocramz/handpose`, both workers, the ort and tract
`.wasm`, both weights and the sample photos. URLs are relative (`base: './'`), so it runs from any path on any
static host. Threaded WASM needs cross-origin isolation (COOP/COEP headers). The dev and preview servers
send the headers. Where a host can't, as on GitHub Pages, `demo/public/coi-serviceworker.js` adds them,
and `demo/isolation.ts` registers it and reloads the page once. Without isolation the demo still runs, on
one thread; the status line says which.
