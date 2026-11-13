// Runs HandPose on a still image and reports through document.title, which smoke.mjs waits on:
// "hands:<n> <backend label>" after a few results, or "fatal: <message>".
// ?engine=ort|tract, ?backend=wasm|webgpu|auto (default wasm: headless Chromium has no usable WebGPU).
import { HandPose, openImage, type Backend, type Engine } from '@ocramz/handpose'

const q = new URLSearchParams(location.search)
const engine: Engine = q.get('engine') === 'tract' ? 'tract' : 'ort'
const backend = (q.get('backend') ?? 'wasm') as Backend | 'auto'
const report = (s: string) => { document.title = s; console.log(s) }

try {
  const source = await openImage('two_hands.jpg')
  const pose = new HandPose({ engine, backend, onFatal: m => report(`fatal: ${m}`) })
  const tick = () => {
    pose.pump(performance.now() / 1000, source, false)
    if (pose.counts.results >= 3) {
      report(`hands:${pose.raw.length} ${pose.backendLabel} crossOriginIsolated=${crossOriginIsolated}`)
      pose.dispose()
      return
    }
    if (!document.title.startsWith('fatal')) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
} catch (e) {
  report(`fatal: ${e instanceof Error ? e.message : String(e)}`)
}
