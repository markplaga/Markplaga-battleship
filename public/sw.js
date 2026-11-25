/* Battleship: Deep Command service worker: makes the game installable.
   Only same-origin files are cached, so solo play works offline once
   installed. Online matches go through the Netlify API and are never
   intercepted, so multiplayer keeps working.
   Bump VERSION whenever you change game files so installed copies refresh. */
const VERSION='battleship-v1';
const CORE = [
  './', 'index.html', 'styles.css',
  'js/core.js', 'js/battle.js', 'js/online.js', 'js/main.js', 'js/audio.js',
  'manifest.webmanifest', 'icons/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    });
    if (hit) { refresh.catch(() => {}); return hit; }
    try { return await refresh; }
    catch (err) {
      if (req.mode === 'navigate') { const home = await cache.match('index.html'); if (home) return home; }
      throw err;
    }
  })());
});
