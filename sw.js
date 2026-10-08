/* Tabaat: validated network-first data, bounded local images, network-only admin. */
importScripts('./js/catalogue-data.js');
const CACHE_NAME = 'tabaat-v17';
const DATA_CACHE = 'tabaat-data-v17';
const IMAGE_CACHE = 'tabaat-images-v17';
const CURRENT_CACHES = new Set([CACHE_NAME, DATA_CACHE, IMAGE_CACHE]);
const ROOT = new URL(self.registration.scope);
const DATA_FILES = ['books.json', 'sciences.json', 'reviews.json'];
const STATIC_ASSETS = [
  './', './index.html', './vendor/purify.min.js', './js/content-security.js',
  './js/catalogue-data.js', './manifest.json', './icons/icon-192.png',
  './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const MAX_IMAGES = 100;
const NETWORK_TIMEOUT = 8000;
const dataVersions = new Map();
let dataSequence = 0;
let dataWrites = Promise.resolve();
let imageWrites = Promise.resolve();

function unavailable(message = 'No saved catalogue is available.') {
  return new Response(message, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function canonical(url) {
  const result = new URL(url);
  result.search = '';
  result.hash = '';
  return result.href;
}
async function network(request, options = {}, consume = response => response) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(request, { ...options, signal: controller.signal }).then(consume),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Network timeout')); }, NETWORK_TIMEOUT);
      })
    ]);
  } finally { clearTimeout(timer); }
}
async function validResponse(response, name) {
  if (!response || !response.ok || response.type === 'opaque') return null;
  try {
    const body = (await response.clone().text()).replace(/^\uFEFF/, '');
    if (!self.TabaatData.valid(name, JSON.parse(body))) return null;
    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    // The body is reconstructed from decoded text; original transport headers no longer apply.
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    return new Response(body, { status: 200, headers });
  } catch { return null; }
}
function tagged(response, source) {
  const headers = new Headers(response.headers);
  headers.set('X-Tabaat-Source', source);
  return new Response(response.body, { status: response.status, headers });
}
async function dataResponse(request, url, sequence) {
  const name = url.pathname.slice(ROOT.pathname.length);
  const key = canonical(url);
  try {
    const response = await network(request, { cache: 'no-store' }, response => validResponse(response, name));
    if (!response) throw new Error('Invalid catalogue response');
    response.headers.set('X-Tabaat-Cached-At', new Date().toISOString());
    const live = tagged(response, 'network');
    try {
      const copy = live.clone();
      const write = dataWrites.catch(() => {}).then(async () => {
        const cache = await caches.open(DATA_CACHE);
        // A slow older request must not replace a newer valid response.
        if (sequence > (dataVersions.get(key) || 0)) {
          await cache.put(key, copy);
          dataVersions.set(key, sequence);
        }
      });
      dataWrites = write;
      await write;
    } catch (error) { console.warn('[SW] Data cache write failed:', error); }
    return live;
  } catch {
    try {
      const cache = await caches.open(DATA_CACHE);
      const saved = await validResponse(await cache.match(key), name);
      if (saved) return tagged(saved, 'cache');
    } catch { /* cache unavailable */ }
    return unavailable();
  }
}

async function migrateData(oldNames) {
  const target = await caches.open(DATA_CACHE);
  // Visit older cache generations first; ties without dates use insertion order.
  const ordered = oldNames.slice().sort((a, b) => Number(a.match(/v(\d+)$/)?.[1] || 0) - Number(b.match(/v(\d+)$/)?.[1] || 0));
  for (const name of DATA_FILES) {
    const key = new URL(name, ROOT).href;
    let best = await validResponse(await target.match(key), name);
    let bestTime = best ? responseTime(best) : -1;
    for (const cacheName of ordered) {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (canonical(request.url) !== key) continue;
        const candidate = await validResponse(await cache.match(request), name);
        if (!candidate) continue;
        const time = responseTime(candidate);
        if (time >= bestTime) { best = candidate; bestTime = time; }
      }
    }
    if (best) await target.put(key, tagged(best, 'cache'));
  }
}
function responseTime(response) {
  for (const header of ['X-Tabaat-Cached-At', 'Last-Modified', 'Date']) {
    const time = Date.parse(response.headers.get(header));
    if (Number.isFinite(time)) return time;
  }
  return 0;
}
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)),
    ...DATA_FILES.map(name => {
      const url = new URL(name, ROOT);
      return dataResponse(new Request(url), url, ++dataSequence);
    })
  ]));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const oldNames = (await caches.keys()).filter(name => name.startsWith('tabaat-') && !CURRENT_CACHES.has(name));
    // If migration fails, activation fails too; old caches are retained for recovery.
    await migrateData(oldNames);
    await Promise.all(oldNames.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
async function imageResponse(request) {
  try {
    let cache;
    try {
      cache = await caches.open(IMAGE_CACHE);
      const saved = await cache.match(request);
      if (saved) return saved;
    } catch { /* cache availability must not prevent live image loading */ }
    const response = await network(request);
    if (cache && response.ok && response.type !== 'opaque') {
      const copy = response.clone();
      const write = imageWrites.catch(() => {}).then(async () => {
        await cache.put(request, copy);
        const keys = await cache.keys();
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(key);
      }).catch(error => console.warn('[SW] Image cache write failed:', error));
      imageWrites = write;
      // event.waitUntil is attached synchronously below via the task wrapper.
      await write;
    }
    return response;
  } catch { return new Response('', { status: 503 }); }
}
async function staticResponse(request, url) {
  const key = canonical(url);
  try {
    const response = await network(request);
    if (response.ok && response.type !== 'opaque') {
      try { await (await caches.open(CACHE_NAME)).put(key, response.clone()); }
      catch (error) { console.warn('[SW] Static cache write failed:', error); }
    }
    return response;
  } catch {
    try {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(key);
      if (saved) return saved;
    } catch { /* cache unavailable */ }
    return unavailable('This page is unavailable offline.');
  }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // External APIs/fonts and sibling applications retain their normal network policy.
  if (event.request.method !== 'GET' || url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const relativePath = url.pathname.slice(ROOT.pathname.length);
  if (relativePath.startsWith('admin/')) {
    event.respondWith(network(event.request, { cache: 'no-store' }).catch(() => unavailable('Admin mode requires an active internet connection.')));
    return;
  }
  let task;
  if (DATA_FILES.includes(relativePath)) task = dataResponse(event.request, url, ++dataSequence);
  else if (!relativePath.startsWith('icons/') && (relativePath.startsWith('images/') || event.request.destination === 'image' || /\.(?:png|svg|ico|webp|jpg|jpeg|gif|avif)$/i.test(relativePath))) task = imageResponse(event.request);
  else if (relativePath === '' || /\.(?:html|js|css|json|png|svg|ico|webp|jpg|jpeg)$/.test(relativePath)) task = staticResponse(event.request, url);
  else return;
  event.respondWith(task);
  event.waitUntil(task.then(() => undefined));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
