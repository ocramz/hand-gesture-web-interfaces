// Runs the whole hand-pose vision pipeline in tract (Rust → wasm, tract/): WebGPU (tract's wgpu runtime)
// when available, else the CPU (wasm simd128, one thread). This worker only letterboxes each frame onto a
// 640² canvas; tract uploads and normalizes it (on the GPU), runs YOLO26, decodes and canonicalizes the
// hands and tracks them into two smoothed slots, which it posts back.
import init, { HandPipeline } from '../../tract/pkg/handpose_tract.js'
import { fetchModel, SLOW_GPU_MS, webgpuAvailable } from './fetchModel.ts'
import { unpackTracked } from './packed.ts'
import { MODEL_SIZE, type Backend, type FromWorker, type Precision, type ToWorker } from './types.ts'
import type { TrackerOptions } from './tracker.ts'

const scope = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
}
const post = (m: FromWorker) => scope.postMessage(m)

const RUNTIME: Record<Backend, string> = { webgpu: 'wgpu', wasm: 'cpu' }
const TRACKER_DEFAULTS: TrackerOptions = { minHits: 2, maxMisses: 5, minCutoff: 1.2, beta: 0.015 }

let pipeline: HandPipeline | null = null
let gpu = false
// A HandPipeline method that is awaiting (a frame) holds the object: a config change waits for the next frame.
let confThreshold = 0.4
let appliedConf = confThreshold
let ctx: OffscreenCanvasRenderingContext2D | null = null

async function init_(msg: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  confThreshold = appliedConf = msg.confThreshold
  await init()
  const hasGpu = msg.backend !== 'wasm' && (await webgpuAvailable())
  const pick = (dflt: Precision): Precision => (msg.precision === 'auto' ? dflt : msg.precision)
  const attempts: [Backend, Precision][] = hasGpu
    ? [['webgpu', pick('fp16')], ['webgpu', 'fp32'], ['wasm', 'fp32']]
    : [['wasm', pick('fp32')]]
  const notes: string[] = ['tract']
  if (msg.backend !== 'wasm' && !hasGpu) notes.push('no WebGPU adapter')
  const bytes: Partial<Record<Precision, Uint8Array>> = {}
  let best: { p: HandPipeline; backend: Backend; precision: Precision; ms: number } | null = null
  for (const [backend, precision] of attempts) {
    // A WebGPU pipeline that runs fast enough wins; a slow one (a software adapter) races the CPU.
    if (best && (best.backend === 'wasm' || best.ms < SLOW_GPU_MS)) break
    try {
      bytes[precision] ??= await fetchModel(msg.urls[precision], post)
      const p = await HandPipeline.create(RUNTIME[backend], bytes[precision], msg.confThreshold)
      await p.warm_up() // compiles shaders, allocates
      const ms = await p.warm_up()
      notes.push(`${backend}/${precision}: ${ms.toFixed(0)} ms`)
      if (!best || ms < best.ms) {
        best?.p.free()
        best = { p, backend, precision, ms }
      } else p.free()
    } catch (e) {
      notes.push(`${backend}/${precision} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!best) {
    post({ type: 'error', message: notes.join('\n') })
    return
  }
  pipeline = best.p
  gpu = best.backend === 'webgpu'
  const t = { ...TRACKER_DEFAULTS, ...msg.tracker }
  pipeline.set_tracker(t.minHits, t.maxMisses, t.minCutoff, t.beta)
  post({ type: 'ready', backend: best.backend, precision: best.precision, threads: best.backend === 'wasm' ? 1 : 0, note: notes.join('; ') })
}

async function frame(msg: Extract<ToWorker, { type: 'frame' }>): Promise<void> {
  const { bitmap } = msg
  if (!pipeline) { bitmap.close(); return }
  if (appliedConf !== confThreshold) pipeline.set_confidence((appliedConf = confThreshold))
  const t0 = performance.now()
  const bw = bitmap.width
  const bh = bitmap.height
  const [, padX, padY, w, h] = HandPipeline.letterbox(bw, bh)
  ctx ??= new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE).getContext('2d', { willReadFrequently: !gpu }) as OffscreenCanvasRenderingContext2D
  ctx.fillStyle = 'rgb(114, 114, 114)'
  ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE)
  ctx.drawImage(bitmap, padX, padY, w, h)
  bitmap.close()
  const srcScale = msg.srcW / bw
  let packed: Float32Array
  let t1: number
  if (gpu) {
    t1 = performance.now()
    packed = await pipeline.run_canvas(ctx.canvas, bw, bh, srcScale, msg.srcW, msg.mirror, msg.t)
  } else {
    const rgba = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data
    t1 = performance.now()
    packed = await pipeline.run_rgba(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), bw, bh, srcScale, msg.srcW, msg.mirror, msg.t)
  }
  const t2 = performance.now()
  const { hands, slots } = unpackTracked(packed)
  post({ type: 'tracked', hands, slots, t: msg.t, inferMs: t2 - t1, prepMs: t1 - t0 })
}

scope.onmessage = e => {
  const msg = e.data
  const run = msg.type === 'init' ? init_(msg) : msg.type === 'frame' ? frame(msg) : Promise.resolve(void (confThreshold = msg.confThreshold))
  run.catch(err => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
}
