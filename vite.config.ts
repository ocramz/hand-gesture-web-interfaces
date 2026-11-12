import { defineConfig } from 'vite'

// Cross-origin isolation lets onnxruntime-web's WASM backend use threads (SharedArrayBuffer).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  // onnxruntime-web finds its .wasm next to its own module (new URL(..., import.meta.url)): pre-bundling
  // would move the module away from it.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
