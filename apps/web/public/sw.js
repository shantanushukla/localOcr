/* localOCR service worker
   - HTML/nav: network-first (always pick up new deploys)
   - Hashed /assets/*: cache-first (immutable)
   - CDN models: cache-first for offline OCR after first load
*/

const CACHE = 'localocr-shell-v3';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  const isNavigate = req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  const isHashedAsset = sameOrigin && url.pathname.startsWith('/assets/');
  const isStaticShell =
    sameOrigin &&
    (url.pathname.endsWith('.webmanifest') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname === '/sw.js');
  const isModelCdn = /cdn\.jsdelivr\.net|unpkg\.com|tessdata|onnx|wasm/i.test(url.href);

  // Network-first for HTML so PDF export fix deploys are visible immediately
  if (isNavigate) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          const fallback = await caches.match('/');
          if (fallback) return fallback;
          throw new Error('offline');
        }),
    );
    return;
  }

  if (!isHashedAsset && !isStaticShell && !isModelCdn) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached && (isHashedAsset || isModelCdn)) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (cached) return cached;
        throw e;
      }
    }),
  );
});
