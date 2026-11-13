// Serves the fixture with `vite preview` (the build; SERVE=dev: the dev server) and checks, in headless Chromium, that each engine loads its
// worker, wasm and weights from the installed package and finds the two hands in two_hands.jpg.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const PORT = 4173
const ENGINES = (process.env.ENGINES ?? 'ort,tract').split(',')
const TIMEOUT_MS = 240_000
const SERVE = process.env.SERVE === 'dev' ? 'dev' : 'preview'

// Run vite itself, not through `npx`: killing the npx wrapper leaves vite holding the port, and the next run
// (`SERVE=dev` right after the preview run) then dies on --strictPort.
const vite = fileURLToPath(new URL('node_modules/vite/bin/vite.js', import.meta.url))
const args = SERVE === 'dev' ? [vite, '--port', String(PORT), '--strictPort'] : [vite, 'preview', '--port', String(PORT), '--strictPort']
const server = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
const exited = new Promise(resolve => server.once('exit', resolve))
await new Promise((resolve, reject) => {
  server.stdout.on('data', d => { if (String(d).includes(String(PORT))) resolve() })
  server.on('exit', code => reject(new Error(`vite ${SERVE} server exited (${code})`)))
})

const browser = await chromium.launch()
let failed = false
try {
  for (const engine of ENGINES) {
    const page = await browser.newPage()
    page.on('console', m => { if (m.type() === 'error') console.error(`[${engine}] ${m.text()}`) })
    page.on('pageerror', e => console.error(`[${engine}] ${e.message}`))
    const t0 = Date.now()
    await page.goto(`http://localhost:${PORT}/?engine=${engine}`)
    await page.waitForFunction(() => /^(hands:|fatal)/.test(document.title), null, { timeout: TIMEOUT_MS })
    const title = await page.title()
    const ok = title.startsWith('hands:2 ')
    failed ||= !ok
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${SERVE} ${engine}: ${title} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    await page.close()
  }
} finally {
  await browser.close()
  server.kill()
  await exited // the port must be free before the next run starts
}
process.exit(failed ? 1 : 0)
