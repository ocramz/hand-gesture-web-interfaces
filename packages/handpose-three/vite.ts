// Vite plugin the apps in this repo add: cross-origin isolation (threaded WASM), keeps onnxruntime-web and
// @ocramz/handpose out of pre-bundling (both locate their workers, .wasm and .onnx files from their own
// module URL, which pre-bundling would move), and serves the sample images at <base>samples/ (dev server) or
// copies them into the build output. The model weights need nothing here: @ocramz/handpose references them
// with `new URL(..., import.meta.url)`, which Vite serves and emits on its own.
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

// The samples are repo test fixtures (the Rust tests read them too), not part of the published package.
const SAMPLES = join(dirname(fileURLToPath(import.meta.resolve('@ocramz/handpose/package.json'))), 'assets', 'samples')
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

// Cross-origin isolation lets onnxruntime-web's WASM backend use threads (SharedArrayBuffer).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export function handpose(): Plugin {
  let base = '/'
  return {
    name: 'ocramz-handpose',
    config: () => ({
      server: { headers: isolation },
      preview: { headers: isolation },
      optimizeDeps: { exclude: ['onnxruntime-web', '@ocramz/handpose'] },
      worker: { format: 'es' },
    }),
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!path.startsWith(base)) return next()
        const rel = normalize(path.slice(base.length))
        if (!rel.startsWith('samples/') || rel.includes('..')) return next()
        const file = join(SAMPLES, rel.slice('samples/'.length))
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Content-Length', statSync(file).size)
        for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v)
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      if (options.dir && existsSync(SAMPLES)) cpSync(SAMPLES, join(options.dir, 'samples'), { recursive: true })
    },
  }
}
