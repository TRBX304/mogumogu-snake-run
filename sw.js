// MOGUMOGU SNAKE RUN — Service Worker
// デプロイのたびに VERSION を上げると、古いキャッシュが確実に入れ替わります。
const VERSION = 'v3';
const APP_CACHE = `msr-app-${VERSION}`;
const RUNTIME_CACHE = `msr-runtime-${VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/config.js',
  './js/course.js',
  './js/game.js',
  './js/sprites.js',
  './js/audio.js',
  './js/ranking.js',
  './js/firebase-config.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png',
];

// オフラインでも遊べるよう、外部から読む静的ファイル（フォント・Firebase SDK）もキャッシュする
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('msr-') && k !== APP_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // ページ遷移：ネット優先。オフラインのときだけキャッシュのトップページを返す
    if (req.mode === 'navigate') {
      event.respondWith(networkFirstPage(req));
      return;
    }
    // それ以外の自サイトのファイル：キャッシュを即返しつつ裏で更新（stale-while-revalidate）
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }

  // フォント・Firebase SDK（バージョン付きURLなので中身は変わらない）：キャッシュ優先
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, RUNTIME_CACHE));
  }
  // Firestore / Auth の通信は触らない（常にネットワーク）
});

async function networkFirstPage(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await fetch(req);
    // トップページだけはオフライン用に保存しておく
    const path = new URL(req.url).pathname;
    if (res.ok && (path === '/' || path.endsWith('/index.html'))) cache.put('./index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('./index.html')) || new Response('offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('offline', { status: 503 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503 });
  }
}
