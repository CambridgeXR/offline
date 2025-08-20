// sw.js
const VERSION = '13'; // bump this for each deploy
const CACHE = `vr-offline-cache-v${VERSION}`;

// Precache the app shell (versioned)
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

  // App shell: network-first for index with offline fallback
  if (url.origin === location.origin && (url.pathname === '/' || url.pathname.endsWith('/index.html'))) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        const cache = await caches.open(CACHE);
        cache.put('./', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./')) ||
               (await cache.match('./index.html')) ||
               (await cache.match('/index.html')) ||
               Response.error();
      }
    })());
    return;
  }

  // Don't intercept byte-range/media or blob/filesystem requests (video/local)
  if (req.headers.has('range') || url.protocol === 'blob:' || url.protocol === 'filesystem:') {
    return; // allow default handling
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

  // CDN (e.g., jsDelivr): stale-while-revalidate
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
