// Offline: everything the app needs is cached on install; afterwards the network goes first (a new version
// shows up on the next load) and the cache answers only when the network can't.
// ponytail: every response is cached again on each load; versioned cache-first if loads ever feel slow.
const CACHE = 'sudoku-scan';
const FILES = ['./', 'manifest.webmanifest', 'vendor/tf.min.js', 'vendor/opencv.js',
  'model/model.json', 'model/weights.bin', 'model/printed/model.json', 'model/printed/weights.bin',
  'fonts/schibsted-grotesk-latin.woff2', 'fonts/schibsted-grotesk-latin-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.oninstall = e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
self.onactivate = e => e.waitUntil(self.clients.claim());
self.onfetch = e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
};
