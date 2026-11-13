// Soap Hands: the webcam's hands hold soap films. Hand pose from a YOLO26 model in onnxruntime-web, or in
// tract (wasm) with ?engine=tract, in a worker; films, rings and bubbles in three.js.
//
// URL parameters: ?image=/samples/two_hands.jpg (a still image instead of the webcam), mirror=0|1,
// engine=ort|tract, backend=webgpu|wasm, precision=fp16|fp32, mode=rings|saddle, debug=1, gui=0.
import { Vector3, type Mesh } from 'three'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import { HandPose, openImage, openWebcam, Stage, type Backend, type Finger, type FrameSource, type Precision } from '@ocramz/handpose'
import type { ShapeParams, Shape } from './modes/common.ts'
import { RingMode } from './modes/ringMode.ts'
import { SaddleMode } from './modes/saddleMode.ts'
import { Bubbles } from './render/bubbles.ts'
import { Droplets } from './render/droplets.ts'
import { sharedFilmUniforms } from './render/filmMaterial.ts'

const query = new URLSearchParams(location.search)

const FINGER_SETS: Record<string, [Finger, Finger, Finger]> = {
  'thumb · index · middle': ['thumb', 'index', 'middle'],
  'thumb · index · pinky': ['thumb', 'index', 'pinky'],
  'thumb · middle · pinky': ['thumb', 'middle', 'pinky'],
  'index · middle · ring': ['index', 'middle', 'ring'],
}

const params = {
  mode: query.get('mode') === 'saddle' ? 'saddle' : 'rings',
  fingers: 'thumb · index · middle',
  tilt: 0.3,
  pop: true,
  sag: 0.12,
  relax: true,
  relaxIterations: 8,
  cameraFov: 60,
  handSize: 1,
  confidence: 0.4,
  intensity: 0.85,
  swirl: 1,
  thickness: 1,
  backgroundDim: 0.8,
  debug: query.get('debug') === '1',
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const hintEl = $('hint')
const errorEl = $('error')

function fail(message: string): void {
  errorEl.textContent = message
  errorEl.classList.add('shown')
  statusEl.textContent = 'stopped'
}

async function openSource(): Promise<FrameSource> {
  const image = query.get('image')
  return image ? openImage(image) : openWebcam()
}

async function main(): Promise<void> {
  statusEl.textContent = 'opening camera…'
  let source: FrameSource
  try {
    source = await openSource()
  } catch (e) {
    fail(`Could not open the ${query.get('image') ? 'image' : 'camera'}:\n${e instanceof Error ? e.message : String(e)}`)
    return
  }
  const mirror = query.has('mirror') ? query.get('mirror') !== '0' : source.kind === 'webcam'
  const stage = new Stage({ canvas: $<HTMLCanvasElement>('gl'), overlay: $<HTMLCanvasElement>('overlay'), source, mirror, hfovDeg: params.cameraFov })
  const { scene, background } = stage

  const shared = sharedFilmUniforms()
  shared.uVideo.value = source.texture
  shared.uMirror.value = mirror ? 1 : 0

  const droplets = new Droplets()
  scene.add(droplets.points)
  stage.onResize(fit => droplets.setScale(((fit.height / 2) * fit.dpr) / Math.tan((fit.fovDeg * Math.PI) / 360)))
  const bubbles = new Bubbles(shared, droplets, (m: Mesh) => scene.add(m), (m: Mesh) => scene.remove(m))
  const fx = { droplets, bubbles }
  const ringMode = new RingMode(shared)
  const saddleMode = new SaddleMode(shared)
  scene.add(ringMode.group, saddleMode.group)
  const shapes: Record<string, Shape> = { rings: ringMode, saddle: saddleMode }
  const applyMode = () => { for (const [k, s] of Object.entries(shapes)) s.setEnabled(k === params.mode) }
  applyMode()

  // Hand pose.
  const pose = new HandPose({
    engine: query.get('engine') === 'tract' ? 'tract' : 'ort',
    backend: (query.get('backend') as Backend | null) ?? 'auto',
    precision: (query.get('precision') as Precision | null) ?? 'auto',
    confThreshold: params.confidence,
    onProgress: m => { statusEl.textContent = m },
    onFatal: fail,
  })
  const { views } = pose
  statusEl.textContent = 'loading model…'

  // Controls.
  if (query.get('gui') !== '0') {
    const gui = new GUI({ title: 'Soap Hands' })
    gui.add(params, 'mode', ['rings', 'saddle']).onChange(applyMode).listen()
    const shape = gui.addFolder('Shape')
    shape.add(params, 'fingers', Object.keys(FINGER_SETS)).name('ring fingers')
    shape.add(params, 'tilt', 0, 0.9, 0.01).name('tilt to camera')
    shape.add(params, 'pop').name('pop when stretched')
    shape.add(params, 'sag', 0, 0.4, 0.01).name('saddle edge sag')
    shape.add(params, 'relax').name('relax surface')
    shape.add(params, 'relaxIterations', 0, 40, 1).name('relax iterations')
    const film = gui.addFolder('Film')
    film.add(params, 'intensity', 0.2, 3, 0.01)
    film.add(params, 'swirl', 0, 3, 0.01)
    film.add(params, 'thickness', 0.4, 2, 0.01)
    film.add(params, 'backgroundDim', 0.2, 1, 0.01).name('background')
    const camFolder = gui.addFolder('Camera & tracking')
    camFolder.add(params, 'cameraFov', 35, 100, 1).name('webcam h-fov°').onChange((v: number) => stage.setFov(v))
    camFolder.add(params, 'handSize', 0.7, 1.4, 0.01).name('hand size')
    camFolder.add(params, 'confidence', 0.15, 0.85, 0.01).onChange((v: number) => pose.setConfidence(v))
    camFolder.add(params, 'debug').name('debug overlay').listen()
    camFolder.close()
    if (innerWidth < 700) gui.close()
  }
  addEventListener('keydown', e => {
    if (e.key === '1') params.mode = 'rings'
    else if (e.key === '2') params.mode = 'saddle'
    else if (e.key === 'd' || e.key === 'D') params.debug = !params.debug
    else return
    applyMode()
  })

  // Exposed for poking at from the console and for automated checks.
  const debugState = { ringMode, saddleMode, views, pose, tracker: pose.tracker, params, counts: pose.counts, get raw() { return pose.raw }, get ready() { return pose.ready }, get busy() { return pose.busy }, get backend() { return pose.backendLabel } }
  ;(window as unknown as { soap: typeof debugState }).soap = debugState

  let last = performance.now() / 1000
  let fps = 60
  let statusAt = 0
  let filmSeen = false
  const pokers: Vector3[] = []
  stage.renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - last)
    last = now
    fps += 0.05 * (1 / Math.max(1e-3, dt) - fps)
    pose.pump(now, source, mirror)

    shared.uTime.value = now
    shared.uIntensity.value = params.intensity
    shared.uSwirl.value = params.swirl
    shared.uThickness.value = params.thickness
    background.setDim(params.backgroundDim)

    pose.updateViews(dt, stage.cam, params.handSize)
    const shapeParams: ShapeParams = {
      fingers: FINGER_SETS[params.fingers],
      tilt: params.tilt,
      pop: params.pop,
      relax: params.relax,
      relaxIterations: params.relaxIterations,
      sag: params.sag,
    }
    const shape = shapes[params.mode]
    shape.update(dt, now, views, shapeParams, fx)
    pokers.length = 0
    pokers.push(...shape.pokers())
    bubbles.update(dt, now, pokers)
    droplets.update(dt)

    stage.render()
    stage.drawDebug(params.debug ? pose.raw : null, views)

    if (!filmSeen && ringMode.state === 'film') {
      filmSeen = true
      setTimeout(() => hintEl.classList.add('hidden'), 2500)
    }
    if (now - statusAt > 0.25) {
      statusAt = now
      if (pose.ready) {
        const hands = views.filter(v => v.active).length
        statusEl.textContent = `${pose.statusLine()} · ${fps.toFixed(0)} fps\n${hands} hand${hands === 1 ? '' : 's'} · ${shape.label}`
      }
    }
  })
}

main().catch(e => fail(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)))
