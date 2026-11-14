// Cross-origin isolation where the host cannot send headers. onnxruntime-web runs threaded WASM only with
// SharedArrayBuffer, which needs the page served with COOP: same-origin and COEP: require-corp. The dev and
// preview servers send them (handpose() in ../vite.ts); a static host such as GitHub Pages does not, so
// public/coi-serviceworker.js adds them to every response and the page reloads once to come under it.
// Without isolation everything still works, on one thread.
const RELOADED = 'handpose-three-demo:coi-reloaded'

/** Resolves when the page is isolated or cannot be; otherwise reloads it under the service worker. */
export async function crossOriginIsolate(): Promise<void> {
  if (crossOriginIsolated) {
    try { sessionStorage.removeItem(RELOADED) } catch { /* storage blocked: nothing to clear */ }
    return
  }
  if (!isSecureContext || !('serviceWorker' in navigator)) return
  try {
    // Already reloaded once this session and still not isolated: this browser won't do it through a worker.
    if (sessionStorage.getItem(RELOADED)) return
    await navigator.serviceWorker.register('./coi-serviceworker.js')
    await navigator.serviceWorker.ready
    sessionStorage.setItem(RELOADED, '1')
  } catch (e) {
    // No storage means no guard against a reload loop, so don't reload.
    console.warn('[demo] no cross-origin isolation, WASM runs on one thread:', e)
    return
  }
  location.reload()
  await new Promise(() => {}) // the page is going away
}
