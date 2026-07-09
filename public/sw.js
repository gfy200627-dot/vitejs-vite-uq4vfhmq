* EHP之姐夫大作战 — Service Worker
 *
 * 缓存策略（专门为 Vite 单包 + Supabase 后端设计，避免“更新了手机还是旧的”）：
 *   1. 导航请求（HTML）        → network-first：联网时永远取最新 index.html，
 *                                从而引用到最新的带哈希资源；离线时回退缓存。
 *   2. 带哈希的静态资源(JS/CSS)→ cache-first：内容变了文件名哈希就变，所以缓存
 *                                永远安全且能秒开（这是 PWA 重复打开变快的关键）。
 *   3. 后端请求(Supabase/Edge) → 完全不拦截：动态数据绝不缓存。
 *
 * 版本管理：每次发版把 CACHE_VERSION 改一下（日期+序号即可）。
 *   install 时 skipWaiting()、activate 时删除所有旧版本缓存并 clients.claim()，
 *   配合页面侧 controllerchange→reload，更新会在下次打开时自动生效。
 * ========================================================================== */

const CACHE_VERSION = 'ehp-v19-2026-07-08-01'; // ← 每次发版改这里
const CACHE_NAME = `ehp-cache-${CACHE_VERSION}`;
const PREFIX = 'ehp-cache-';

// ---- 安装：尽快就绪，立即取代旧 SW ----
self.addEventListener('install', () => {
  // 不预缓存带哈希的构建产物（文件名构建期才确定）；首屏 HTML 走 network-first，
  // 资源按访问 cache-first 填充即可。
  self.skipWaiting();
});

// ---- 激活：删除所有非当前版本的缓存，并接管已打开页面 ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// 后端 / 动态请求：一律放行，绝不缓存
function isApiRequest(url) {
  return (
    url.hostname.endsWith('.supabase.co') || // Supabase REST / Auth / Realtime / Edge
    url.pathname.startsWith('/functions/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/rest/') ||
    url.pathname.startsWith('/realtime/')
  );
}

// Vite 构建产物 / 内容寻址的静态资源：可长期缓存
function isHashedAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|ico|json)$/i.test(
      url.pathname
    )
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // 只处理 GET

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 跨域（Supabase、DeepSeek 等）直接走网络，绝不经过缓存
  if (url.origin !== self.location.origin) return;
  // 同源 API 也不缓存
  if (isApiRequest(url)) return;

  const accept = req.headers.get('accept') || '';
  const isNavigation = req.mode === 'navigate' || accept.includes('text/html');

  // 1) 导航：network-first
  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, fresh.clone());
          return fresh;
        } catch (e) {
          const cached = (await caches.match(req)) || (await caches.match('/index.html'));
          return (
            cached ||
            new Response('离线，且本地没有可用缓存。请联网后重试。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }
      })()
    );
    return;
  }

  // 2) 带哈希的静态资源：cache-first
  if (isHashedAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.status === 200 && fresh.type === 'basic') {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch (e) {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 3) 其它同源 GET：网络优先，失败回退缓存
  event.respondWith(
    (async () => {
      try {
        return await fetch(req);
      } catch (e) {
        return (await caches.match(req)) || Response.error();
      }
    })()
  );
});

// 备用：页面也可主动发消息让新 SW 立即接管（install 已 skipWaiting，这里是双保险）
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
