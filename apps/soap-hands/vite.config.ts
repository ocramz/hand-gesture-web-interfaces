import { defineConfig } from 'vite'
import { handpose } from '@ocramz/handpose-three/vite'

export default defineConfig({
  plugins: [handpose()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
