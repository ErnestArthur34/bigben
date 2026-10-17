/* DANEST POS service worker: caches the app shell so it opens fast and loads offline.
   Firestore/Auth traffic is never cached, so sales and stock always come live from Firebase. */
const CACHE = 'danest-pos-shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET') return;
  const sameOrigin = u.origin === location.origin;
  const sdk = u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  if (!sameOrigin && !sdk) return;               // Firestore, Auth, fonts etc. go straight to the network
  if (r.mode === 'navigate') {                   // pages: network first, cached copy when offline
    e.respondWith(fetch(r).then(res => { caches.open(CACHE).then(c => c.put('./index.html', res.clone())); return res; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {   // assets: cache first
    if (res.ok) caches.open(CACHE).then(c => c.put(r, res.clone()));
    return res;
  })));
});
