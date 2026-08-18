/* 考研阅读 Web 版 - Service Worker（离线优先 + 后台更新）
   版本号由 tools/build-data.js 在构建时注入，勿手改 CACHE 行 */
var CACHE = 'kaoyan-reader-c7a2198f63';
var RUNTIME_CACHE = CACHE + '-runtime';
var RUNTIME_MAX = 200; /* 运行期缓存条目上限（文章正文按需缓存） */

var ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './css/fonts.css',
  './js/ui.js',
  './js/tts.js',
  './js/store.js',
  './js/dict.js',
  './js/app.js',
  './data/index.js',
  './data/dict.js',
  './fonts/libre-bodoni-400.woff2',
  './fonts/libre-bodoni-500.woff2',
  './fonts/libre-bodoni-600.woff2',
  './fonts/libre-bodoni-700.woff2',
  './fonts/libre-bodoni-italic-400.woff2',
  './fonts/public-sans-400.woff2',
  './fonts/public-sans-500.woff2',
  './fonts/public-sans-600.woff2',
  './fonts/public-sans-700.woff2',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k !== CACHE && k !== RUNTIME_CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 运行期缓存超限清理：按插入顺序删除最旧条目 */
function trimRuntime(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= RUNTIME_MAX) return null;
    return cache.delete(keys[0]).then(function () { return trimRuntime(cache); });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  var req = e.request;

  /* 文章正文：缓存优先，命中即离线可读；未命中走网络并写入运行期缓存 */
  if (url.pathname.indexOf('/data/articles/') === 0) {
    e.respondWith(
      caches.open(RUNTIME_CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          if (cached) return cached;
          return fetch(req).then(function (resp) {
            if (resp && resp.ok) {
              var copy = resp.clone();
              cache.put(req, copy).then(function () { return trimRuntime(cache); });
            }
            return resp;
          });
        });
      })
    );
    return;
  }

  /* 同源静态资源：stale-while-revalidate —— 命中缓存立即返回，后台静默更新供下次使用；
     强制刷新（Ctrl+F5 / reload）时网络优先，确保能立即拿到新版本 */
  var forceFresh = req.cache === 'no-cache' || req.cache === 'reload';
  e.respondWith(
    caches.match(req).then(function (cached) {
      var refresh = fetch(req).then(function (resp) {
        if (resp && resp.ok && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      }).catch(function () { return null; });
      if (cached && !forceFresh) return cached;
      return refresh.then(function (resp) {
        if (resp) return resp;
        if (cached) return cached; /* 离线时退回旧缓存 */
        throw new Error('offline and not cached');
      });
    })
  );
});
