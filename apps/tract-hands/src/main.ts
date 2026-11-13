// Tract Hands: the webcam's hand keypoints as 3D skeletons over the video. The whole hand-pose vision
// pipeline (letterboxed frame → YOLO26 → decode → tracking) runs in tract, compiled to wasm, in a worker.
//
// URL parameters: ?image=/samples/two_hands.jpg (a still image instead of the webcam), mirror=0|1,
// engine=tract|ort (to compare with onnxruntime-web), backend=webgpu|wasm, precision=fp16|fp32, debug=1.
import { DirectionalLight, HemisphereLight } from 'three'
import { HandPose, openImage, openWebcam, Stage, type Backend, type FrameSource, type Precision } from '@ocramz/handpose'
import { HandSkeleton } from './skeleton.ts'

const query = new URLSearchParams(location.search)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const errorEl = $('error')

function fail(message: string): void {
  errorEl.textContent = message
  errorEl.classList.add('shown')
  statusEl.textContent = 'stopped'
}

async function main(): Promise<void> {
  statusEl.textContent = 'opening camera…'
  const image = query.get('image')
  let source: FrameSource
  try {
    source = image ? await openImage(image) : await openWebcam()
  } catch (e) {
    fail(`Could not open the ${image ? 'image' : 'camera'}:\n${e instanceof Error ? e.message : String(e)}`)
    return
  }
  const mirror = query.has('mirror') ? query.get('mirror') !== '0' : source.kind === 'webcam'
  const stage = new Stage({ canvas: $<HTMLCanvasElement>('gl'), overlay: $<HTMLCanvasElement>('overlay'), source, mirror, hfovDeg: 60 })
  stage.background.setDim(1)
  stage.scene.add(new HemisphereLight(0xffffff, 0x404858, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.8)
  sun.position.set(0.3, 0.6, 1) // from behind the viewer, so the side facing the camera is lit
  stage.scene.add(sun)
  const skeleton = new HandSkeleton(stage.scene)

  const pose = new HandPose({
    engine: query.get('engine') === 'ort' ? 'ort' : 'tract',
    backend: (query.get('backend') as Backend | null) ?? 'auto',
    precision: (query.get('precision') as Precision | null) ?? 'auto',
    onProgress: m => { statusEl.textContent = m },
    onFatal: fail,
  })
  statusEl.textContent = 'loading model…'
  const debug = query.get('debug') === '1'
  ;(window as unknown as { hands: unknown }).hands = { pose, views: pose.views, counts: pose.counts }

  let last = performance.now() / 1000
  let fps = 60
  let statusAt = 0
  stage.renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - last)
    last = now
    fps += 0.05 * (1 / Math.max(1e-3, dt) - fps)
    pose.pump(now, source, mirror)
    pose.updateViews(dt, stage.cam)
    skeleton.update(pose.views)
    stage.render()
    stage.drawDebug(debug ? pose.raw : null, pose.views)
    if (pose.ready && now - statusAt > 0.25) {
      statusAt = now
      const hands = pose.views.filter(v => v.active).length
      statusEl.textContent = `${pose.statusLine()} · ${fps.toFixed(0)} fps\n${hands} hand${hands === 1 ? '' : 's'}`
    }
  })
}

main().catch(e => fail(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)))
