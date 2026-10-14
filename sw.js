// Change la version à chaque mise à jour (le script bump.sh le fait pour toi)
const CACHE = 'jarvis-v36';
const ASSETS = [
  './', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './core/core.css', './core/core.js', './core/voice.js', './core/briefing.js', './core/notify.js', './core/chat.js',
  './modules/finances/finances.css', './modules/finances/finances.js',
  './modules/sante/sante.css', './modules/sante/sante.js',
  './modules/nutrition/nutrition.css', './modules/nutrition/nutrition.js', './modules/nutrition/ciqual.json',
  './modules/muscu/muscu.css', './modules/muscu/muscu.js', './modules/muscu/wger.json',
  './modules/taches/taches.css', './modules/taches/taches.js',
  './modules/habitudes/habitudes.css', './modules/habitudes/habitudes.js',
  './modules/notes/notes.css', './modules/notes/notes.js',
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

// Notifications push (envoyées par le serveur Jarvis)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {title: 'J.A.R.V.I.S.', body: e.data ? e.data.text() : ''}; }
  e.waitUntil(self.registration.showNotification(d.title || 'J.A.R.V.I.S.', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', tag: d.tag || undefined, data: {url: d.url || '#/'},
  }));
});
// Toucher une notification : ouvre Jarvis sur le bon module
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '#/';
  e.waitUntil((async () => {
    const wins = await clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const c of wins) { c.postMessage({go: url}); return c.focus(); }
    return clients.openWindow('./index.html' + url);
  })());
});
