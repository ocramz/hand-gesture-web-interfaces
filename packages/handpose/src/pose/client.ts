// The main-thread side of the hand-pose pipeline: owns the model worker, feeds it frames, tracks the hands
// it returns into two stable slots, and keeps per-slot HandViews (smoothed keypoints, depth, camera rays).
// With the tract engine the worker does the tracking too, and the slots arrive with each result.
import type { CameraModel } from '../camera.ts'
import { HandView, updateHandViews } from '../hands.ts'
import type { FrameSource } from '../source.ts'
import { HandTracker, type TrackedSlot, type TrackedSlots, type TrackerOptions } from './tracker.ts'
import { MODEL_SIZE, type Backend, type Engine, type FromWorker, type Hand, NUM_KP, type Precision, type ToWorker } from './types.ts'

export interface HandPoseOptions {
  /** `ort` (onnxruntime-web, default) or `tract` (the whole pipeline, tracking included, in wasm). */
  engine?: Engine
  /** Slot hysteresis and smoothing. */
  tracker?: Partial<TrackerOptions>
  backend?: Backend | 'auto'
  precision?: Precision | 'auto'
  /** Detection confidence threshold, 0..1. */
  confThreshold?: number
  /** Model URLs; default: `models/yolo26_hand_pose_{fp16,fp32}.onnx` under the app's base URL. */
  modelUrls?: Record<Precision, string>
  /** Model download progress, as a status line. */
  onProgress?: (message: string) => void
  /** The model could not load or run. */
  onFatal?: (message: string) => void
}

const emptySlot = (): TrackedSlot => ({ active: false, conf: 0, kp: new Float32Array(NUM_KP * 3) })

export class HandPose {
  readonly engine: Engine
  /** The two tracked slots: tracked here (ORT), or in the worker and copied from its results (tract). */
  readonly tracker: TrackedSlots
  readonly views: [HandView, HandView] = [new HandView(), new HandView()]
  /** The latest raw detections, in source pixels. */
  raw: Hand[] = []
  ready = false
  busy = false
  backendLabel = ''
  /** Smoothed model time per frame (ms), preprocessing included. */
  inferMs = 0
  /** Smoothed model results per second. */
  poseHz = 0
  readonly counts = { sent: 0, results: 0, errors: 0, lastError: '' }

  private readonly worker: Worker
  private readonly localTracker: HandTracker | null
  private readonly remote: { slots: [TrackedSlot, TrackedSlot] } | null
  private lastResult = 0
  private srcW = 0
  private mirror = true

  constructor(opts: HandPoseOptions = {}) {
    const { engine = 'ort', backend = 'auto', precision = 'auto', confThreshold = 0.4, onProgress, onFatal } = opts
    this.engine = engine
    if (engine === 'tract') {
      this.localTracker = null
      this.remote = { slots: [emptySlot(), emptySlot()] }
      this.tracker = this.remote
    } else {
      this.localTracker = new HandTracker(opts.tracker)
      this.remote = null
      this.tracker = this.localTracker
    }
    // Two literal URLs: Vite bundles a worker only from `new Worker(new URL('<literal>', import.meta.url))`.
    this.worker = engine === 'tract'
      ? new Worker(new URL('./tractWorker.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data
      if (m.type === 'progress') {
        onProgress?.(`loading ${m.file} ${m.total ? Math.round((100 * m.loaded) / m.total) + '%' : (m.loaded / 1e6).toFixed(0) + ' MB'}`)
      } else if (m.type === 'ready') {
        this.ready = true
        this.backendLabel = `${engine === 'tract' ? 'tract ' : ''}${m.backend} ${m.precision}${m.threads ? ` ×${m.threads}` : ''}`
        if (m.note) console.info('[handpose]', m.note)
        if (m.backend === 'wasm' && backend !== 'wasm') this.backendLabel += ' (no usable WebGPU: slow)'
      } else if (m.type === 'error') {
        if (!this.ready) onFatal?.(`The hand model could not run:\n${m.message}`)
        else console.error('[handpose]', m.message)
        this.counts.errors++
        this.counts.lastError = m.message
        this.busy = false
      } else if (m.type === 'result' || m.type === 'tracked') {
        this.counts.results++
        this.busy = false
        this.raw = m.hands
        this.inferMs += 0.2 * (m.inferMs + m.prepMs - this.inferMs)
        const now = performance.now() / 1000
        if (this.lastResult) this.poseHz += 0.2 * (1 / Math.max(1e-3, now - this.lastResult) - this.poseHz)
        this.lastResult = now
        if (m.type === 'tracked') {
          if (this.remote) this.remote.slots = m.slots
        } else this.localTracker?.update(m.hands, m.t, this.srcW, this.mirror)
      }
    }
    this.worker.onerror = e => onFatal?.(`Worker error: ${e.message}`)
    const base = new URL(import.meta.env.BASE_URL, location.href)
    const modelUrls = opts.modelUrls ?? {
      fp16: new URL('models/yolo26_hand_pose_fp16.onnx', base).href,
      fp32: new URL('models/yolo26_hand_pose_fp32.onnx', base).href,
    }
    this.send({ type: 'init', urls: modelUrls, backend, precision, confThreshold, tracker: opts.tracker })
  }

  setConfidence(confThreshold: number): void {
    this.send({ type: 'config', confThreshold })
  }

  /** Sends the source's current frame to the model if it is idle and the frame is new. Call every frame. */
  pump(now: number, source: FrameSource, mirror: boolean): void {
    if (!this.ready || this.busy || !source.hasNewFrame(now)) return
    this.busy = true
    this.srcW = source.width
    this.mirror = mirror
    source.grab(MODEL_SIZE)
      .then(bitmap => {
        this.counts.sent++
        this.send({ type: 'frame', bitmap, srcW: source.width, srcH: source.height, t: performance.now() / 1000, mirror }, [bitmap])
      })
      .catch(e => {
        this.counts.errors++
        this.counts.lastError = String(e)
        this.busy = false
      })
  }

  /** Advances the HandViews toward the tracker at the render rate. Call every frame. */
  updateViews(dt: number, cam: CameraModel, handScale = 1): void {
    updateHandViews(this.views, this.tracker, cam, dt, handScale)
  }

  /** "backend · ms · pose Hz", for a status line. */
  statusLine(): string {
    return `${this.backendLabel} · ${this.inferMs.toFixed(0)} ms · pose ${this.poseHz.toFixed(0)} Hz`
  }

  dispose(): void {
    this.worker.terminate()
  }

  private send(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(m, transfer)
  }
}
