/* Vecker service worker
   Documents and scripts: network-first, falling back to cache. Cache-first was
   wrong here and shipped a real bug — a deployed fix could never reach anyone,
   because the cached index.html won every time and users kept tapping dead
   links from an older build. Offline still works: fetch rejects immediately
   with no connection and the cache answers.
   Icons and the manifest: cache-first, since they change by filename.
   Sefaria + Supabase texts: stale-while-revalidate into a separate, long-lived cache
   so a section read once is readable forever offline. */

const VERSION = 'v2.1.0';
const SHELL = `vecker-shell-${VERSION}`;
const TEXTS = 'luach-texts';

const SHELL_FILES = [
  './',
  './index.html',
  './siddur.html',
  './tehillim.html',
  './mishnayos.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  // config.js and store.js are blocking dependencies of siddur.html — without
  // them the page cannot start, so they belong in the shell rather than being
  // fetched on demand.
  './js/config.js',
  './js/store.js',
  './js/api.js',
  './js/sync.js',
  './js/texts.js',
  './js/reminders.js',
  './js/notify.js',
  './js/settings.js',
  './js/platform.js',
  './js/zmanim.js',
  './offline.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES).catch(() => Promise.all(
        SHELL_FILES.map(f => c.add(f).catch(() => null))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => (k.startsWith('vecker-shell-') || k.startsWith('luach-shell-')) && k !== SHELL)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isTextApi(url) {
  return url.hostname.endsWith('sefaria.org') ||
         url.hostname.endsWith('hebcal.com') ||
         (url.hostname.endsWith('supabase.co') && url.pathname.includes('luach_siddur_texts'));
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Texts: serve cache immediately, refresh in the background.
  if (isTextApi(url)) {
    event.respondWith(
      caches.open(TEXTS).then(async cache => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => null);
        if (hit) { event.waitUntil(network); return hit; }
        const res = await network;
        return res || new Response(
          JSON.stringify({ error: 'offline', message: 'This section has not been cached yet.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Same-origin.
  if (url.origin === self.location.origin) {
    const fresh = req.mode === 'navigate' ||
                  /\.(?:html|js|webmanifest)$/.test(url.pathname) ||
                  url.pathname === '/' || url.pathname.endsWith('/');

    if (fresh) {
      // Network-first: a deploy must reach the user on their next load.
      event.respondWith(
        fetch(req)
          .then(res => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(SHELL).then(c => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match(req).then(hit =>
            hit || (req.mode === 'navigate'
              ? caches.match('./index.html')
              : new Response('', { status: 504 }))))
      );
      return;
    }

    // Everything else (icons): cache-first.
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req)
        .then(res => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(SHELL).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => new Response('', { status: 504 })))
    );
  }
});

/* Notification taps: focus an existing window rather than opening a new one. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) { c.navigate(target); return c.focus(); }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'clearTexts') caches.delete(TEXTS);
  /* Nuclear option for an install stuck on an old shell: drop every cache and
     take over immediately. The page reloads itself afterwards. */
  if (event.data === 'clearAll') {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => self.skipWaiting())
        .then(() => self.clients.claim())
    );
  }
});
