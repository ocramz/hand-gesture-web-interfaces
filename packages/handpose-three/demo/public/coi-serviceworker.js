// Adds the two cross-origin isolation headers to every response, for static hosts that cannot set headers
// (GitHub Pages). isolation.ts registers this worker and reloads the page once under it; the dev and preview
// servers send the headers themselves and never register it. Everything the demo loads is same-origin, so
// COEP: require-corp blocks nothing.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', event => {
  const request = event.request
  // fetch() rejects these (they come from devtools): leave them to the browser.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return
  event.respondWith(
    fetch(request).then(response => {
      // Opaque responses (and opaque redirects) have no headers to change.
      if (response.status === 0) return response
      const headers = new Headers(response.headers)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }),
  )
})
