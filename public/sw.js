const CACHE = 'shiftops-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { self.clients.claim(); });
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api')) return; // don't cache API
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })
  );
});
