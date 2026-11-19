/*
 * Shelter Watch offline cache. Serves the last copy it has right away and
 * refreshes it in the background (stale-while-revalidate), so the directory
 * and call buttons still work on a bad connection or with no signal.
 * Only same-origin GET requests are cached; Firebase traffic is never touched.
 */
const CACHE = 'shelter-watch-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'config.js', 'store.js', 'app.js', 'sw-register.js', 'facilities.json',
  'lib/schema.js', 'lib/moderation.js', 'lib/factcheck.js', 'lib/ratings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
