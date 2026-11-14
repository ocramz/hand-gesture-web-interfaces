// The @ocramz/handpose-three demo: the Stage API, live. 3D markers sit on the tracked hands' keypoints
// (HandView.point → camera space → the Stage's matched three.js camera → the pixel the webcam saw), the
// debug overlay draws the same keypoints in 2D to compare, and the panel drives the rest of the API.
//
// URL parameters (the panel sets them): image=samples/two_hands.jpg (a still image instead of the webcam),
// mirror=0|1, engine=ort|tract, backend=auto|webgpu|wasm, fov=<degrees>, dim=0..1, debug=0|1.
import { DirectionalLight, HemisphereLight } from 'three'
import { HandPose, openImage, openWebcam, type Backend, type Engine, type FrameSource } from '@ocramz/handpose'
import { Stage } from '@ocramz/handpose-three'
import { crossOriginIsolate } from './isolation.ts'
import { HandMarkers, PINCH_M } from './markers.ts'

const query = new URLSearchParams(location.search)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const errorEl = $('error')

function numberParam(key: string, fallback: number, lo: number, hi: number): number {
  const v = Number(query.get(key))
  return query.has(key) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

const image = query.get('image')
const engine: Engine = query.get('engine') === 'tract' ? 'tract' : 'ort'
const backendParam = query.get('backend')
const backend: Backend | 'auto' = backendParam === 'webgpu' || backendParam === 'wasm' ? backendParam : 'auto'
const fov = numberParam('fov', 60, 40, 100)
const dim = numberParam('dim', 0.8, 0, 1)
let debug = query.get('debug') === '1'

/** Writes a URL parameter; `reload` for the ones only a new Stage or HandPose can take. */
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

/** The controls that reload the page work before (and without) a camera. */
function bindReloadControls(mirror: boolean): void {
  const sourceEl = $<HTMLSelectElement>('source')
  sourceEl.value = image ?? ''
  sourceEl.onchange = () => {
    query.delete('mirror') // back to the new source's default
    setParam('image', sourceEl.value || null, true)
  }
  const mirrorEl = $<HTMLInputElement>('mirror')
  mirrorEl.checked = mirror
  mirrorEl.onchange = () => setParam('mirror', mirrorEl.checked ? '1' : '0', true)
  const engineEl = $<HTMLSelectElement>('engine')
  engineEl.value = engine
  engineEl.onchange = () => setParam('engine', engineEl.value, true)
  const backendEl = $<HTMLSelectElement>('backend')
  backendEl.value = backend
  backendEl.onchange = () => setParam('backend', backendEl.value === 'auto' ? null : backendEl.value, true)
}

function bindLiveControls(stage: Stage): void {
  const fovEl = $<HTMLInputElement>('fov')
  const fovOut = $<HTMLOutputElement>('fov-out')
  fovEl.value = String(fov)
  fovOut.value = `${fov}°`
  fovEl.oninput = () => {
    stage.setFov(Number(fovEl.value))
    fovOut.value = `${fovEl.value}°`
    setParam('fov', fovEl.value, false)
  }
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
  bindReloadControls(query.has('mirror') ? query.get('mirror') !== '0' : !image)
  await crossOriginIsolate()

  statusEl.textContent = image ? 'loading image…' : 'opening camera…'
  let source: FrameSource
  try {
    source = image ? await openImage(image) : await openWebcam()
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    fail(`Could not open the ${image ? 'image' : 'camera'}:\n${why}${image ? '' : '\n\nPick the sample photo in the panel to try it without a camera.'}`)
    return
  }
  // The webcam is shown as a selfie (mirrored), the photo as it is, unless ?mirror says otherwise.
  const mirror = query.has('mirror') ? query.get('mirror') !== '0' : source.kind === 'webcam'
  const stage = new Stage({ canvas: $<HTMLCanvasElement>('gl'), overlay: $<HTMLCanvasElement>('overlay'), source, mirror, hfovDeg: fov })
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
    pose.pump(now, source, mirror)
    pose.updateViews(dt, stage.cam)
    const hands = markers.update(pose.views)
    stage.render()
    stage.drawDebug(debug ? pose.raw : null, pose.views)
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
