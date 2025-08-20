// sw.js
const VERSION = '36';
const CACHE = `vr-offline-cache-v${VERSION}`;

const APP_SHELL = [
  './',
  './?source=pwa',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
].map(url => `${url}${url.includes('?') ? '&' : '?'}v=${VERSION}`);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_SHELL);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : Promise.resolve())));
    self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass local media / range / blob / filesystem
  if (req.headers.has('range') || url.protocol === 'blob:' || url.protocol === 'filesystem:') {
    return;
  }

  // Treat scope root (e.g. /offline/) as the app index
  const scopePath = new URL(self.registration.scope).pathname; // e.g., "/offline/"
  const isScopeIndex =
    url.origin === location.origin &&
    (url.pathname === scopePath || url.pathname === scopePath + 'index.html');

  if (isScopeIndex) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE);
        const rootURL  = new URL(scopePath, self.location.origin).toString();
        const indexURL = new URL(scopePath + 'index.html', self.location.origin).toString();
        await cache.put(rootURL, fresh.clone());
        await cache.put(indexURL, fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        const cachedRoot  = await cache.match(new URL(scopePath, self.location.origin));
        const cachedIndex = await cache.match(new URL(scopePath + 'index.html', self.location.origin));
        return cachedRoot || cachedIndex || Response.error();
      }
    })());
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // CDN: stale-while-revalidate
  if (url.hostname.endsWith('cdn.jsdelivr.net')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => undefined);
      return cached || fetchPromise || fetch(req);
    })());
  }
});
