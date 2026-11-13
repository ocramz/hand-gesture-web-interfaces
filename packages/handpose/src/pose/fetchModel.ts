// What both model workers (onnxruntime-web and tract) share: downloading the weights with progress, and
// finding out whether a WebGPU adapter exists.
import type { FromWorker } from './types.ts'

export async function fetchModel(url: string, post: (m: FromWorker) => void): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} (run npm run fetch-model)`)
  const total = Number(res.headers.get('content-length')) || 0
  const file = url.split('/').pop() ?? url
  if (!res.body) return new Uint8Array(await res.arrayBuffer())
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  let last = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    if (loaded - last > 1 << 20) { last = loaded; post({ type: 'progress', loaded, total, file }) }
  }
  const out = new Uint8Array(loaded)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  // A dev server's fallback page is not a model.
  if (out.length < 1 << 20) throw new Error(`${url} is ${out.length} bytes: not the model (run npm run fetch-model)`)
  return out
}

export async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return false
  try { return (await gpu.requestAdapter()) != null } catch { return false }
}

/** Above this per-frame time a WebGPU session is suspected to be a software adapter. */
export const SLOW_GPU_MS = 250
