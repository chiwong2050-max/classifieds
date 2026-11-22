/* ListNear service worker - app shell + offline home page.
   We deliberately keep caching minimal: only static shell assets and the home
   page are cached, so listings and search results are always fresh. */
const CACHE = 'listnear-shell-v2';
const SHELL = [
  '/css/styles.css',
  '/js/app.js',
  '/favicon.svg',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache admin, API, or auth-related routes.
  if (/^\/(admin|api|manage|verify|post)/.test(url.pathname)) return;

  // Home page: network-first, fall back to the last cached copy, then the
  // offline page. This is the page we want available with no connection.
  if (url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || caches.match('/offline.html')))
    );
    return;
  }

  // Cache-first for shell assets, network-first (with offline fallback) for pages.
  const isShell = SHELL.some((p) => url.pathname === p) || url.pathname.startsWith('/icons/');

  if (isShell) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache successful CSS/JS/images opportunistically.
        if (response.ok && /\.(css|js|webp|png|svg|jpg)$/.test(url.pathname)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/offline.html'))
      )
  );
});
