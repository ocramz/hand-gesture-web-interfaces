// A fullscreen three.js stage over the camera frame: the video cover-fits the canvas as the background, and
// the 3D camera's fov is matched to it, so a point in camera space lands on the pixel the webcam saw it at.
// A 2D overlay canvas on top carries the debug drawing.
import { NoToneMapping, PerspectiveCamera, Scene, WebGLRenderer, type Texture } from 'three'
import { CameraModel, clearOverlay, drawDebug, type FrameSource, type Hand, type HandView } from '@ocramz/handpose'
import { createBackground, type Background } from './background.ts'
import { sourceTexture } from './texture.ts'

export interface StageOptions {
  canvas: HTMLCanvasElement
  overlay: HTMLCanvasElement
  source: FrameSource
  mirror: boolean
  /** The webcam's horizontal field of view, degrees. */
  hfovDeg: number
}

export interface StageFit {
  /** Vertical fov of the 3D camera, degrees. */
  fovDeg: number
  /** Fraction of the video's width and height that is visible. */
  uvScale: [number, number]
  width: number
  height: number
  dpr: number
}

export class Stage {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(50, 1, 0.01, 20)
  readonly cam = new CameraModel()
  readonly background: Background
  readonly source: FrameSource
  /** The source's frames as a three.js texture (what the background shows). */
  readonly texture: Texture
  readonly mirror: boolean
  private readonly overlay: HTMLCanvasElement
  private readonly octx: CanvasRenderingContext2D
  private hfovDeg: number
  private readonly resizeHooks: Array<(fit: StageFit) => void> = []

  constructor(opts: StageOptions) {
    this.source = opts.source
    this.mirror = opts.mirror
    this.hfovDeg = opts.hfovDeg
    this.overlay = opts.overlay
    this.octx = opts.overlay.getContext('2d') as CanvasRenderingContext2D
    this.renderer = new WebGLRenderer({ canvas: opts.canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.toneMapping = NoToneMapping
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.cam.set(this.source.width, this.source.height, this.hfovDeg, this.mirror)
    this.texture = sourceTexture(this.source)
    this.background = createBackground(this.texture)
    this.scene.add(this.background.mesh)
    addEventListener('resize', () => this.resize())
    this.resize()
  }

  /** Called on every resize (and once now) with the new fit. */
  onResize(hook: (fit: StageFit) => void): void {
    this.resizeHooks.push(hook)
    hook(this.fit())
  }

  setFov(hfovDeg: number): void {
    this.hfovDeg = hfovDeg
    this.resize()
  }

  resize(): void {
    const w = innerWidth
    const h = innerHeight
    this.renderer.setSize(w, h, false)
    const dpr = this.renderer.getPixelRatio()
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.cam.set(this.source.width, this.source.height, this.hfovDeg, this.mirror)
    const fit = this.fit()
    this.camera.fov = fit.fovDeg
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.background.setFit(fit.uvScale, this.mirror)
    for (const hook of this.resizeHooks) hook(fit)
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  /** Draws raw detections and tracked hands on the overlay, or clears it when `raw` is null. */
  drawDebug(raw: readonly Hand[] | null, views: readonly HandView[] = []): void {
    if (raw) drawDebug(this.octx, this.cam, raw, views, this.renderer.getPixelRatio())
    else clearOverlay(this.octx)
  }

  private fit(): StageFit {
    const w = innerWidth
    const h = innerHeight
    return { ...this.cam.coverFit(w, h), width: w, height: h, dpr: this.renderer.getPixelRatio() }
  }
}
