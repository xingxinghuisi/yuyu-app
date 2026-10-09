/* 语屿 Kotoba · Service Worker（极简版） */
var CACHE_NAME = 'yuyu-v23';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './map-model.js',
  './map.js',
  './map-art.js',
  './map.css',
  './anime.css',
  // 动漫群岛小图预缓存（首屏快显）；大图与海面按需运行时缓存
  './assets/anime/sea-small.webp',
  './assets/anime/sakura-small.webp',
  './assets/anime/torii-small.webp',
  './assets/anime/fuji-small.webp',
  './assets/anime/maple-small.webp',
  './assets/anime/snow-small.webp',
  './assets/anime/traveler.webp',
  './manifest.json'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  // 仅处理同源 GET（cache-first）
  if (req.method !== 'GET') return;
  try {
    var url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
  } catch (e) { return; }

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // 只缓存成功的同源静态资源，不缓存 /api
        var u = new URL(req.url);
        if (res && res.ok && u.pathname.indexOf('/api') !== 0) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 离线且无缓存时，若是页面导航则返回 index.html
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
