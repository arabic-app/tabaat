/* =====================================================
   Service Worker — Tabaat PWA
   Scope root : ./  (couvre index.html ET admin/)
   Stratégie :
     - books.json / sciences.json  → Network First (données fraîches)
     - images/                      → Cache First
     - HTML/CSS/fonts               → Network First avec fallback cache
   ===================================================== */

const CACHE_NAME = 'tabaat-v7';
const STATIC_ASSETS = [
  './',
  './index.html',
  './admin/',
  './admin/index.html',
  './admin/manifest.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-admin-192.png',
  './icons/icon-admin-512.png',
  './icons/apple-touch-icon-admin.png',
];

/* ── INSTALL ── */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Certains assets non mis en cache :', err);
      });
    })
  );
});

/* ── ACTIVATE : nettoyage des anciens caches ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Suppression ancien cache :', key);
            return caches.delete(key);
          })
      );
    }).then(() => self.clients.claim())
  );
});

/* ── FETCH ── */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.hostname === 'api.github.com') return;

  // ── ADMIN APP : Network Only (pas de fonctionnement offline)
  if (url.pathname.includes('/admin/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() => {
        return new Response('Admin mode requires an active internet connection.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain' })
        });
      })
    );
    return;
  }

  // ── DATA : Network First (toujours données fraîches)
  // Ignorer les paramètres de recherche (?v=...) pour la comparaison du cache hors ligne
  const isDataFile =
    url.pathname.endsWith('books.json') ||
    url.pathname.endsWith('sciences.json') ||
    url.pathname.endsWith('reviews.json');
  if (isDataFile) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => {
          // Hors ligne : chercher dans le cache en ignorant les paramètres de requête (?v=...)
          return caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request, { ignoreSearch: true }).then((cached) => {
              if (cached) return cached;
              return new Response(JSON.stringify([]), {
                headers: { 'Content-Type': 'application/json' }
              });
            });
          });
        })
    );
    return;
  }

  // ── IMAGES : Cache First
  if (url.pathname.includes('/images/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // ── TOUT LE RESTE : Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
          return new Response('', { status: 503 });
        });
      })
  );
});

/* ── MESSAGE ── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
