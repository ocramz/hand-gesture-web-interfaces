// What an app needs to use @ocramz/handpose with plain Vite (no plugin from this repo):
import { defineConfig } from 'vite'

// Cross-origin isolation lets onnxruntime-web's WASM backend use threads (SharedArrayBuffer).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  // Both packages find their workers, .wasm and .onnx files next to their own modules
  // (new URL(..., import.meta.url)); pre-bundling would move the modules away from them.
  optimizeDeps: { exclude: ['@ocramz/handpose', 'onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
