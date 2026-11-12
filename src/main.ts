// Soap Hands: the webcam's hands hold soap films. Hand pose from a YOLO26 model in onnxruntime-web (in a
// worker); films, rings and bubbles in three.js.
//
// URL parameters: ?image=/samples/two_hands.jpg (a still image instead of the webcam), mirror=0|1,
// backend=webgpu|wasm, precision=fp16|fp32, mode=rings|saddle, debug=1, gui=0.
import { NoToneMapping, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Mesh } from 'three'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import { CameraModel } from './geom/camera.ts'
import { HandView, updateHandViews } from './hands.ts'
import type { ShapeParams, Shape } from './modes/common.ts'
import { RingMode } from './modes/ringMode.ts'
import { SaddleMode } from './modes/saddleMode.ts'
import { HandTracker } from './pose/tracker.ts'
import type { Finger, FromWorker, Hand, ToWorker } from './pose/types.ts'
import { createBackground } from './render/background.ts'
import { Bubbles } from './render/bubbles.ts'
import { clearOverlay, drawDebug } from './render/debugOverlay.ts'
import { Droplets } from './render/droplets.ts'
import { sharedFilmUniforms } from './render/filmMaterial.ts'
import { openImage, openWebcam, type FrameSource } from './source.ts'

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
  const canvas = $<HTMLCanvasElement>('gl')
  const overlay = $<HTMLCanvasElement>('overlay')
  const octx = overlay.getContext('2d') as CanvasRenderingContext2D
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.toneMapping = NoToneMapping
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.01, 20)

  statusEl.textContent = 'opening camera…'
  let source: FrameSource
  try {
    source = await openSource()
  } catch (e) {
    fail(`Could not open the ${query.get('image') ? 'image' : 'camera'}:\n${e instanceof Error ? e.message : String(e)}`)
    return
  }
  const mirror = query.has('mirror') ? query.get('mirror') !== '0' : source.kind === 'webcam'
  const cam = new CameraModel()
  cam.set(source.width, source.height, params.cameraFov, mirror)

  const shared = sharedFilmUniforms()
  shared.uVideo.value = source.texture
  shared.uMirror.value = mirror ? 1 : 0
  const background = createBackground(source.texture)
  scene.add(background.mesh)

  const droplets = new Droplets()
  scene.add(droplets.points)
  const bubbles = new Bubbles(shared, droplets, (m: Mesh) => scene.add(m), (m: Mesh) => scene.remove(m))
  const fx = { droplets, bubbles }
  const ringMode = new RingMode(shared)
  const saddleMode = new SaddleMode(shared)
  scene.add(ringMode.group, saddleMode.group)
  const shapes: Record<string, Shape> = { rings: ringMode, saddle: saddleMode }
  const applyMode = () => { for (const [k, s] of Object.entries(shapes)) s.setEnabled(k === params.mode) }
  applyMode()

  function resize(): void {
    const w = innerWidth
    const h = innerHeight
    renderer.setSize(w, h, false)
    const dpr = renderer.getPixelRatio()
    overlay.width = Math.round(w * dpr)
    overlay.height = Math.round(h * dpr)
    cam.set(source.width, source.height, params.cameraFov, mirror)
    const fit = cam.coverFit(w, h)
    camera.fov = fit.fovDeg
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    background.setFit(fit.uvScale, mirror)
    droplets.setScale(((h / 2) * dpr) / Math.tan((fit.fovDeg * Math.PI) / 360))
  }
  addEventListener('resize', resize)
  resize()

  // Hand pose worker.
  const tracker = new HandTracker()
  const views: [HandView, HandView] = [new HandView(), new HandView()]
  let raw: Hand[] = []
  let ready = false
  let busy = false
  let backendLabel = ''
  let inferMs = 0
  let poseHz = 0
  let lastResult = 0
  const counts = { sent: 0, results: 0, errors: 0, lastError: '' }
  const worker = new Worker(new URL('./pose/worker.ts', import.meta.url), { type: 'module' })
  const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data
    if (m.type === 'progress') {
      statusEl.textContent = `loading ${m.file} ${m.total ? Math.round((100 * m.loaded) / m.total) + '%' : (m.loaded / 1e6).toFixed(0) + ' MB'}`
    } else if (m.type === 'ready') {
      ready = true
      backendLabel = `${m.backend} ${m.precision}${m.threads ? ` ×${m.threads}` : ''}`
      if (m.note) console.info('[soap-hands]', m.note)
      if (m.backend === 'wasm' && query.get('backend') !== 'wasm') backendLabel += ' (no usable WebGPU: slow)'
    } else if (m.type === 'error') {
      if (!ready) fail(`The hand model could not run:\n${m.message}`)
      else console.error('[soap-hands]', m.message)
      counts.errors++
      counts.lastError = m.message
      busy = false
    } else if (m.type === 'result') {
      counts.results++
      busy = false
      raw = m.hands
      inferMs += 0.2 * (m.inferMs + m.prepMs - inferMs)
      const now = performance.now() / 1000
      if (lastResult) poseHz += 0.2 * (1 / Math.max(1e-3, now - lastResult) - poseHz)
      lastResult = now
      tracker.update(m.hands, m.t, source.width, mirror)
    }
  }
  worker.onerror = e => fail(`Worker error: ${e.message}`)
  const base = new URL(import.meta.env.BASE_URL, location.href)
  send({
    type: 'init',
    urls: { fp16: new URL('models/yolo26_hand_pose_fp16.onnx', base).href, fp32: new URL('models/yolo26_hand_pose_fp32.onnx', base).href },
    backend: (query.get('backend') as 'webgpu' | 'wasm' | null) ?? 'auto',
    precision: (query.get('precision') as 'fp16' | 'fp32' | null) ?? 'auto',
    confThreshold: params.confidence,
  })
  statusEl.textContent = 'loading model…'

  function pump(now: number): void {
    if (!ready || busy || !source.hasNewFrame(now)) return
    busy = true
    source.grab(640)
      .then(bitmap => {
        counts.sent++
        send({ type: 'frame', bitmap, srcW: source.width, srcH: source.height, t: performance.now() / 1000 }, [bitmap])
      })
      .catch(e => {
        counts.errors++
        counts.lastError = String(e)
        busy = false
      })
  }

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
    camFolder.add(params, 'cameraFov', 35, 100, 1).name('webcam h-fov°').onChange(resize)
    camFolder.add(params, 'handSize', 0.7, 1.4, 0.01).name('hand size')
    camFolder.add(params, 'confidence', 0.15, 0.85, 0.01).onChange((v: number) => send({ type: 'config', confThreshold: v }))
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
  const debugState = { ringMode, saddleMode, views, tracker, params, counts, get raw() { return raw }, get ready() { return ready }, get busy() { return busy }, get backend() { return backendLabel } }
  ;(window as unknown as { soap: typeof debugState }).soap = debugState

  let last = performance.now() / 1000
  let fps = 60
  let statusAt = 0
  let filmSeen = false
  const pokers: Vector3[] = []
  renderer.setAnimationLoop(() => {
    const now = performance.now() / 1000
    const dt = Math.min(0.1, now - last)
    last = now
    fps += 0.05 * (1 / Math.max(1e-3, dt) - fps)
    pump(now)

    shared.uTime.value = now
    shared.uIntensity.value = params.intensity
    shared.uSwirl.value = params.swirl
    shared.uThickness.value = params.thickness
    background.setDim(params.backgroundDim)

    updateHandViews(views, tracker, cam, dt, params.handSize)
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

    renderer.render(scene, camera)

    if (params.debug) drawDebug(octx, cam, raw, views, renderer.getPixelRatio())
    else clearOverlay(octx)

    if (!filmSeen && ringMode.state === 'film') {
      filmSeen = true
      setTimeout(() => hintEl.classList.add('hidden'), 2500)
    }
    if (now - statusAt > 0.25) {
      statusAt = now
      if (ready) {
        const hands = views.filter(v => v.active).length
        statusEl.textContent = `${backendLabel} · ${inferMs.toFixed(0)} ms · pose ${poseHz.toFixed(0)} Hz · ${fps.toFixed(0)} fps\n${hands} hand${hands === 1 ? '' : 's'} · ${shape.label}`
      }
    }
  })
}

main().catch(e => fail(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e)))
