// Runs the hand-pose model off the main thread: WebGPU (fp16 weights) when available, else WASM (fp32).
// Receives frames as ImageBitmaps, letterboxes them to 640², and posts back decoded hands.
import * as ort from 'onnxruntime-web/webgpu'
import { decodeHands, letterbox, rgbaToChw } from './decode.ts'
import { fetchModel, SLOW_GPU_MS, webgpuAvailable } from './fetchModel.ts'
import { MODEL_SIZE, type Backend, type FromWorker, type Precision, type ToWorker } from './types.ts'

const scope = self as unknown as {
  postMessage(m: FromWorker, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null
  crossOriginIsolated: boolean
  name: string
}
const post = (m: FromWorker) => scope.postMessage(m)

let session: ort.InferenceSession | null = null
let inputName = 'images'
let outputName = 'output0'
let confThreshold = 0.4
let ctx: OffscreenCanvasRenderingContext2D | null = null
const input = new Float32Array(3 * MODEL_SIZE * MODEL_SIZE)

async function init(msg: Extract<ToWorker, { type: 'init' }>): Promise<void> {
  confThreshold = msg.confThreshold
  const threads = scope.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1
  ort.env.wasm.numThreads = threads
  const gpu = msg.backend !== 'wasm' && (await webgpuAvailable())
  const pick = (dflt: Precision): Precision => (msg.precision === 'auto' ? dflt : msg.precision)
  const attempts: [Backend, Precision][] = gpu
    ? [['webgpu', pick('fp16')], ['webgpu', 'fp32'], ['wasm', 'fp32']]
    : [['wasm', pick('fp32')]]
  const notes: string[] = []
  if (msg.backend !== 'wasm' && !gpu) notes.push('no WebGPU adapter')
  const bytes: Partial<Record<Precision, Uint8Array>> = {}
  let best: { s: ort.InferenceSession; backend: Backend; precision: Precision; ms: number } | null = null
  for (const [backend, precision] of attempts) {
    // A WebGPU session that runs fast enough wins; a slow one (a software adapter) races WASM.
    if (best && (best.backend === 'wasm' || best.ms < SLOW_GPU_MS)) break
    try {
      bytes[precision] ??= await fetchModel(msg.urls[precision], post)
      const s = await ort.InferenceSession.create(bytes[precision], {
        executionProviders: [backend],
        graphOptimizationLevel: 'all',
      })
      const ms = await timeRuns(s)
      notes.push(`${backend}/${precision}: ${ms.toFixed(0)} ms`)
      if (!best || ms < best.ms) {
        await best?.s.release()
        best = { s, backend, precision, ms }
      } else await s.release()
    } catch (e) {
      notes.push(`${backend}/${precision} failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!best) {
    post({ type: 'error', message: notes.join('\n') })
    return
  }
  session = best.s
  inputName = session.inputNames[0]
  outputName = session.outputNames[0]
  post({ type: 'ready', backend: best.backend, precision: best.precision, threads: best.backend === 'wasm' ? threads : 0, note: notes.join('; ') })
}

/** Warms a session up (the first run compiles shaders and allocates) and times a second run. */
async function timeRuns(s: ort.InferenceSession): Promise<number> {
  const feeds = () => ({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) })
  const first = await s.run(feeds())
  for (const v of Object.values(first)) v.dispose?.()
  const t0 = performance.now()
  const second = await s.run(feeds())
  for (const v of Object.values(second)) v.dispose?.()
  return performance.now() - t0
}

async function frame(msg: Extract<ToWorker, { type: 'frame' }>): Promise<void> {
  const { bitmap } = msg
  if (!session) { bitmap.close(); return }
  const t0 = performance.now()
  const bw = bitmap.width
  const lb = letterbox(bw, bitmap.height)
  ctx ??= new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE).getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  ctx.fillStyle = 'rgb(114, 114, 114)'
  ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE)
  ctx.drawImage(bitmap, lb.padX, lb.padY, lb.w, lb.h)
  bitmap.close()
  rgbaToChw(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data, MODEL_SIZE, input)
  const t1 = performance.now()
  const out = await session.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) })
  const t2 = performance.now()
  const tensor = out[outputName]
  const hands = decodeHands(tensor.data as Float32Array, lb, { confThreshold, maxHands: 2, iouThreshold: 0.6, srcScale: msg.srcW / bw })
  for (const v of Object.values(out)) v.dispose?.()
  post({ type: 'result', hands, t: msg.t, inferMs: t2 - t1, prepMs: t1 - t0 })
}

// In a production build onnxruntime-web is bundled into this file, and it starts its WASM threads from
// its own module URL, i.e. this file, named 'em-pthread'. Those must keep onnxruntime's message handler.
if (!scope.name.startsWith('em-pthread')) {
  scope.onmessage = e => {
    const msg = e.data
    const run = msg.type === 'init' ? init(msg) : msg.type === 'frame' ? frame(msg) : Promise.resolve(void (confThreshold = msg.confThreshold))
    run.catch(err => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
  }
}
