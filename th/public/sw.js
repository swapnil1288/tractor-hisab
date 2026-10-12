/* App-shell cache only. API responses (private financial data) are never cached by the service worker. */
const CACHE = 'th-shell-v9';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/i18n.js', '/pictos.js', '/billing.js', '/manifest.webmanifest', '/icons/logo.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const isNav = e.request.mode === 'navigate';
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(isNav ? '/index.html' : e.request, cp)); } return r; })
    .catch(() => caches.match(isNav ? '/index.html' : e.request).then(r => r || caches.match('/index.html'))));
});
