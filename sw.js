// Keeps the app itself available without a connection. Train data is never cached here:
// a stale time is worse than no time, so saved trains show their last known times inside the app.
const VERSION = 'milepost-1.0.0';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/config.js', 'js/mapview.js', 'js/model.js', 'js/services.js', 'js/store.js', 'js/track.js', 'js/ui.js',
  'js/views/about.js', 'js/views/find.js', 'js/views/mine.js', 'js/views/passport.js', 'js/views/results.js', 'js/views/train.js',
  'vendor/preact-htm.js', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'fonts/big-shoulders-display-latin-wght-normal.woff2', 'fonts/big-shoulders-display-latin-ext-wght-normal.woff2',
  'fonts/barlow-latin-400-normal.woff2', 'fonts/barlow-latin-500-normal.woff2', 'fonts/barlow-latin-600-normal.woff2',
  'fonts/barlow-latin-ext-400-normal.woff2', 'fonts/barlow-latin-ext-500-normal.woff2', 'fonts/barlow-latin-ext-600-normal.woff2',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request).catch(() => caches.match('index.html'))),
  );
});
