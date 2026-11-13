import { defineConfig } from 'vite'
import { handpose } from '@ocramz/handpose/vite'

export default defineConfig({
  plugins: [handpose()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
