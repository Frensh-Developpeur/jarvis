// Change la version à chaque mise à jour (le script bump.sh le fait pour toi)
const CACHE = 'jarvis-v5';
const ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './core/core.css', './core/core.js',
  './modules/finances/finances.css', './modules/finances/finances.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, {cache: 'reload'}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord en ignorant le cache HTTP (toujours la dernière version), cache seulement hors ligne.
// Les appels à l'API (autre domaine) ne sont jamais mis en cache.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('workers.dev')) return;
  const sameOrigin = url.origin === self.location.origin;
  e.respondWith(
    fetch(sameOrigin ? new Request(req, {cache: 'no-store'}) : req)
      .then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, {ignoreSearch: true}))
  );
});
