/* KSL Digital Log Book — offline shell.
   Same-origin files are pre-cached; the Tailwind CDN and Google Fonts are
   cached the first time they are fetched, so the app also styles offline. */
const CACHE = 'ksl-logbook-v3';
const SHELL = [
  './', './index.html', './admin.html',
  './assets/css/style.css',
  './assets/js/app.js',
  './assets/js/admin.js',
  './assets/icon.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never cache the sync POSTs
  if (req.url.includes('script.google.com')) return;      // always hit the network

  const sameOrigin = new URL(req.url).origin === location.origin;

  // App files: network first, so an edit reaches the device on the next load.
  // Cache is the fallback, which is what keeps the app working offline.
  if (sameOrigin) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // Tailwind CDN + fonts: cache first, they never change under us.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
