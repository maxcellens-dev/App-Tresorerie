const CACHE_NAME = 'tresorerie-v2';
const PRECACHE_URLS = [
  '/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isNavigation =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Navigation vers une route inconnue (404/erreur) → servir l'app (SPA shell)
        // au lieu d'une page d'erreur, pour ne pas rester bloqué.
        if (isNavigation && !response.ok) {
          return caches.match('/').then((cached) => cached || response);
        }
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Réseau indisponible → cache de la requête, sinon l'app (index)
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (isNavigation) return caches.match('/');
          return Response.error();
        });
      })
  );
});
