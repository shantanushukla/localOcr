/* localOCR service worker — cache app shell for offline after first visit.
   Model weights (CDN) are cache-first when fetched once. */

const CACHE = 'localocr-shell-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache opaque document uploads (there are none by design)
  // Cache-first for same-origin app assets + CDN model weights for offline OCR
  const isShell =
    url.origin === self.location.origin &&
    (url.pathname === '/' ||
      url.pathname.endsWith('.html') ||
      url.pathname.startsWith('/assets/') ||
      url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.webmanifest') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.svg') ||
      url.pathname.endsWith('.woff2'));

  const isModelCdn =
    /cdn\.jsdelivr\.net|unpkg\.com|tessdata|onnx|wasm/i.test(url.href);

  if (!isShell && !isModelCdn) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) {
        // Background refresh for shell
        if (isShell) {
          event.waitUntil(
            fetch(req)
              .then((res) => {
                if (res.ok) cache.put(req, res.clone());
              })
              .catch(() => {}),
          );
        }
        return cached;
      }
      try {
        const res = await fetch(req);
        if (res.ok) {
          cache.put(req, res.clone());
        }
        return res;
      } catch (e) {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallback = await cache.match('/');
          if (fallback) return fallback;
        }
        throw e;
      }
    }),
  );
});
