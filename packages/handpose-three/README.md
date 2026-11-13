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
