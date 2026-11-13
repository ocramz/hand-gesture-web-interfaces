// Vite plugin every app using @ocramz/handpose adds: cross-origin isolation (threaded WASM), keeps
// onnxruntime-web out of pre-bundling, and serves the model weights and sample images at <base>models/ and
// <base>samples/ (dev server) or copies them into the build output.
import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const ASSETS = fileURLToPath(new URL('./assets/', import.meta.url))
const DIRS = ['models', 'samples']
const TYPES: Record<string, string> = {
  '.onnx': 'application/octet-stream',
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
      // onnxruntime-web finds its .wasm next to its own module (new URL(..., import.meta.url)): pre-bundling
      // would move the module away from it.
      optimizeDeps: { exclude: ['onnxruntime-web'] },
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
        if (!DIRS.some(d => rel.startsWith(d + '/')) || rel.includes('..')) return next()
        const file = join(ASSETS, rel)
        if (!existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Content-Length', statSync(file).size)
        for (const [k, v] of Object.entries(isolation)) res.setHeader(k, v)
        createReadStream(file).pipe(res)
      })
    },
    writeBundle(options) {
      if (!options.dir) return
      for (const d of DIRS) {
        const src = join(ASSETS, d)
        if (existsSync(src)) cpSync(src, join(options.dir, d), { recursive: true })
      }
    },
  }
}
