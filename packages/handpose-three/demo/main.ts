// The @ocramz/handpose-three demo: the Stage API, live, on the mirrored webcam. 3D markers sit on the
// tracked hands' keypoints (HandView.point → camera space → the Stage's matched three.js camera → the pixel
// the webcam saw), the debug overlay draws the model's raw detections (boxes and confidence), and the panel
// drives the rest of the API.
//
// URL parameters (the panel sets them): engine=tract|ort, backend=webgpu|auto|wasm, dim=0..1, debug=0|1.
import { DirectionalLight, HemisphereLight } from 'three'
import { HandPose, openWebcam, type Backend, type Engine, type FrameSource } from '@ocramz/handpose'
import { Stage } from '@ocramz/handpose-three'
import { crossOriginIsolate } from './isolation.ts'
import { HandMarkers, PINCH_M } from './markers.ts'
import { drawBoxes } from './overlay.ts'

/** The webcam's horizontal field of view, degrees: a typical laptop webcam. It only calibrates the depth;
 * the markers stay on their pixels at any fov. */
const HFOV_DEG = 60
const DEFAULT_ENGINE: Engine = 'tract'
const DEFAULT_BACKEND: Backend = 'webgpu'

const query = new URLSearchParams(location.search)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const errorEl = $('error')

function numberParam(key: string, fallback: number, lo: number, hi: number): number {
  const v = Number(query.get(key))
  return query.has(key) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

const engine: Engine = query.get('engine') === 'ort' ? 'ort' : DEFAULT_ENGINE
const backendParam = query.get('backend')
// webgpu falls back to wasm where there is no usable WebGPU adapter, so it is safe as the default.
const backend: Backend | 'auto' = backendParam === 'auto' || backendParam === 'wasm' ? backendParam : DEFAULT_BACKEND
const dim = numberParam('dim', 0.05, 0, 1)
let debug = query.get('debug') === '1'

/** Writes a URL parameter; `reload` for the ones only a new HandPose can take. */
function setParam(key: string, value: string | null, reload: boolean): void {
  if (value === null) query.delete(key)
  else query.set(key, value)
  const search = query.toString()
  const url = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`
  if (reload) location.assign(url)
  else history.replaceState(null, '', url)
}

function fail(message: string): void {
  errorEl.textContent = message
  errorEl.classList.add('shown')
  statusEl.textContent = 'stopped'
}

/** The controls that reload the page work before (and without) a camera. A default value leaves the URL. */
function bindReloadControls(): void {
  const engineEl = $<HTMLSelectElement>('engine')
  engineEl.value = engine
  engineEl.onchange = () => setParam('engine', engineEl.value === DEFAULT_ENGINE ? null : engineEl.value, true)
  const backendEl = $<HTMLSelectElement>('backend')
  backendEl.value = backend
  backendEl.onchange = () => setParam('backend', backendEl.value === DEFAULT_BACKEND ? null : backendEl.value, true)
}

function bindLiveControls(stage: Stage): void {
  const dimEl = $<HTMLInputElement>('dim')
  const dimOut = $<HTMLOutputElement>('dim-out')
  dimEl.value = String(dim)
  dimOut.value = dim.toFixed(2)
  dimEl.oninput = () => {
    stage.background.setDim(Number(dimEl.value))
    dimOut.value = Number(dimEl.value).toFixed(2)
    setParam('dim', dimEl.value, false)
  }
  const debugEl = $<HTMLInputElement>('debug')
  debugEl.checked = debug
  const setDebug = (on: boolean) => {
    debug = on
    debugEl.checked = on
    setParam('debug', on ? '1' : null, false)
  }
  debugEl.onchange = () => setDebug(debugEl.checked)
  addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) setDebug(!debug)
  })
}

const cm = (m: number) => (m * 100).toFixed(0)

async function main(): Promise<void> {
  if (matchMedia('(min-width: 700px)').matches) $<HTMLDetailsElement>('panel').open = true
  bindReloadControls()
  await crossOriginIsolate()

  statusEl.textContent = 'opening camera…'
  let source: FrameSource
  try {
    source = await openWebcam()
  } catch (e) {
    fail(`Could not open the camera:\n${e instanceof Error ? e.message : String(e)}`)
    return
  }
  // The webcam is shown as a selfie (mirrored).
  const overlay = $<HTMLCanvasElement>('overlay')
  const stage = new Stage({ canvas: $<HTMLCanvasElement>('gl'), overlay, source, mirror: true, hfovDeg: HFOV_DEG })
  // The same context the Stage holds; the Stage keeps the canvas sized.
  const octx = overlay.getContext('2d') as CanvasRenderingContext2D
  stage.background.setDim(dim)
  stage.scene.add(new HemisphereLight(0xffffff, 0x404858, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.8)
  sun.position.set(0.3, 0.6, 1) // from behind the viewer, so the side facing the camera is lit
  stage.scene.add(sun)
  const markers = new HandMarkers(stage.scene)
  bindLiveControls(stage)

  const pose = new HandPose({ engine, backend, onProgress: m => { statusEl.textContent = m }, onFatal: fail })
  statusEl.textContent = 'loading model…'
  // For poking at in the console, and for headless checks.
  ;(window as unknown as { demo: unknown }).demo = { pose, stage, source }

  let last = performance.now() / 1000
  let fps = 60
  let statusAt = 0
  stage.renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - last)
    last = now
    fps += 0.05 * (1 / Math.max(1e-3, dt) - fps)
    pose.pump(now, source, true)
    pose.updateViews(dt, stage.cam)
    const hands = markers.update(pose.views)
    stage.render()
    drawBoxes(octx, stage.cam, debug ? pose.raw : [], stage.renderer.getPixelRatio())
    if (pose.ready && now - statusAt > 0.25) {
      statusAt = now
      const lines = [`${pose.statusLine()} · ${fps.toFixed(0)} fps`]
      hands.forEach((h, i) => {
        if (!h.active) return
        const pinched = h.pinch < PINCH_M ? ' · pinched' : ''
        lines.push(`${i === 0 ? 'L' : 'R'}: ${cm(h.depth)} cm away · thumb–index ${cm(h.pinch)} cm${pinched}`)
      })
      if (lines.length === 1) lines.push('no hands')
      lines.push(crossOriginIsolated ? 'cross-origin isolated' : 'not cross-origin isolated: WASM on one thread')
      statusEl.textContent = lines.join('\n')
    }
  })
}

main().catch(e => fail(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)))
