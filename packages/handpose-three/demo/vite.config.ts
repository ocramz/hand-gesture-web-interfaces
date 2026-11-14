// The demo builds to one static folder (demo/dist/) that runs from any path on any static host: a relative
// base, and everything it loads (workers, the ort and tract .wasm, the weights, the sample photo) emitted
// next to index.html. handpose() is the same plugin the apps use.
import { defineConfig } from 'vite'
import { handpose } from '@ocramz/handpose-three/vite'

export default defineConfig({
  base: './',
  plugins: [handpose()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
