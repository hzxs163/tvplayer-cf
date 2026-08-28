const CACHE_NAME = 'tvplayer-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/hls.min.js',
  '/manifest.json'
];

// 安装 Service Worker
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('✅ 缓存已打开');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
  );
});

// 激活 Service Worker
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ 删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// 拦截请求，优先从缓存返回
// ============================================================
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ============================================================
  // 🆕 关键：如果是 .ts 分片请求，转发给 /api/play 代理
  // ============================================================
  if (url.pathname.endsWith('.ts') || url.pathname.includes('.ts?')) {
    const proxyUrl = '/api/play?url=' + encodeURIComponent(event.request.url);
    event.respondWith(fetch(proxyUrl));
    return;
  }

  // ============================================================
  // 原有逻辑：优先从缓存返回
  // ============================================================
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 缓存命中，返回缓存
        if (response) {
          return response;
        }
        // 否则请求网络
        return fetch(event.request).then((response) => {
          // 只缓存成功的 GET 请求
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(event.request, responseToCache);
            });
          return response;
        });
      })
  );
});
