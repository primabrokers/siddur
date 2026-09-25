/* eslint-env serviceworker */
/**
 * Service worker (11 §6).
 *
 * Boring on purpose. The offline story this app actually promises is narrow:
 * Quick Capture must open and save in a basement simcha hall, and the last
 * Action Stream and recently-viewed profiles should still render with a stale
 * banner. Everything else may require connectivity. So this file does three
 * things and no more:
 *
 *   - **precache the shell** so the app boots with no network at all;
 *   - **network-first for the API** (Supabase, edge functions) — donor data is
 *     never served stale without having been fetched fresh first, and a cached
 *     copy is a fallback, not a strategy;
 *   - **cache-first for hashed static assets**, which are immutable by name.
 *
 * Navigations are network-first too, so a deploy is picked up the moment the
 * device is online: the new `index.html` names new hashed assets, which simply
 * miss the cache and get fetched. `VERSION` is the belt to that's braces —
 * bump it and every old cache is dropped on activate.
 *
 * Deliberately NOT here: background sync, push, POST replay. The capture queue
 * is IndexedDB in the page (`features/capture/offlineQueue.ts`) where it can be
 * inspected and retried by code that knows what a capture is.
 */

const VERSION = 'p1x-1'
const SHELL_CACHE = `crm-shell-${VERSION}`
const ASSET_CACHE = `crm-assets-${VERSION}`
const DATA_CACHE = `crm-data-${VERSION}`
const CACHES = [SHELL_CACHE, ASSET_CACHE, DATA_CACHE]

/** The built shell. Vite emits hashed assets; these are the stable entries. */
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Individually, so one 404 (an icon that moved) cannot fail the install.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !CACHES.includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

const isApi = (url) =>
  url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/functions/v1/')

const isStatic = (url) =>
  url.origin === self.location.origin &&
  (url.pathname.startsWith('/assets/') || /\.(?:css|js|woff2?|png|svg|ico|webmanifest)$/.test(url.pathname))

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  try {
    const response = await fetch(request)
    // Opaque and error responses are not worth keeping.
    if (response && response.ok && request.method === 'GET') cache.put(request, response.clone())
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) return cached
    throw error
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (response && response.ok) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(() =>
        caches.match('/index.html').then((cached) => cached ?? Response.error()),
      ),
    )
    return
  }

  if (isApi(url)) {
    event.respondWith(networkFirst(request, DATA_CACHE))
    return
  }

  if (isStatic(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})
