const CACHE_PREFIX = 'love-diary-';
const CACHE_NAME = 'love-diary-v3.9.68';
const MEDIA_CACHE_NAME = 'love-diary-media-v1';
const MAX_MEDIA_CACHE_ENTRIES = 160;

// Only application-shell files are cached in CACHE_NAME.
const PRECACHE_ASSETS = [
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './css/variables.css', './css/base.css', './css/header.css', './css/timer.css', './css/timeline.css',
    './css/dialogs.css', './css/comments.css', './css/ai-panel.css', './css/fab.css', './css/auth.css',
    './css/profile.css', './css/notifications.css', './css/mood.css', './css/anniversary.css',
    './css/effects.css', './css/responsive.css', './css/pages.css', './css/refresh.css',
    './js/config.js', './js/animations.js', './js/timer.js', './js/auth.js', './js/profile.js',
    './js/moments.js', './js/milestones.js', './js/comments.js', './js/likes.js', './js/mood.js', './js/anniversary.js',
    './js/lightbox.js', './js/ai.js', './js/blindbox.js', './js/presence.js', './js/theme.js',
    './js/notifications.js', './js/effects.js', './js/settings.js', './js/router.js', './js/app.js'
];

const PRECACHE_URLS = PRECACHE_ASSETS.map(asset => new URL(asset, self.registration.scope).href);
const PRECACHE_BY_PATH = new Map(PRECACHE_URLS.map(url => [new URL(url).pathname, url]));
const OFFLINE_URL = new URL('./index.html', self.registration.scope).href;

async function precacheShell() {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(PRECACHE_URLS.map(async url => {
        const request = new Request(url, { cache: 'no-cache', credentials: 'same-origin' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        await cache.put(request, response);
    }));

    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
        await caches.delete(CACHE_NAME);
        throw new Error(`Service Worker: ${failed.length} shell asset(s) could not be precached.`);
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        await precacheShell();
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        const previousAppCaches = keys
            .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && key !== MEDIA_CACHE_NAME);
        await Promise.all(previousAppCaches.map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirstNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            await cache.put(OFFLINE_URL, response.clone());
            return response;
        }

        const fallback = await cache.match(OFFLINE_URL);
        return fallback || response;
    } catch (error) {
        const fallback = await cache.match(OFFLINE_URL);
        return fallback || new Response('当前处于离线状态，请恢复网络后重试。', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

async function cacheFirstShell(request, canonicalUrl) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(canonicalUrl);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
        await cache.put(canonicalUrl, response.clone());
    }
    return response;
}

function isCacheableStorageImage(request, url) {
    if (url.hostname !== 'tveiegolbotlqpjpwpes.supabase.co') return false;
    if (!url.pathname.startsWith('/storage/v1/object/')) return false;

    // 严禁缓存带 Range 头的分段请求（视频/音频流式播放必定携带），避免 206 状态码导致 Cache.put 报错或播放器卡死
    if (request.headers && request.headers.has('range')) return false;

    // 排除常见音视频格式，保证流媒体走浏览器原生网络管道
    const pathLower = url.pathname.toLowerCase();
    if (/\.(mp4|mov|webm|ogg|m4v|mp3|wav|m4a|aac|flac)$/i.test(pathLower)) {
        return false;
    }

    return true;
}

function getCanonicalMediaKey(url) {
    // 规范化路径并剥离短期鉴权 token 参数，以持久化命中本地缓存
    const normalizedPath = url.pathname
        .replace('/storage/v1/object/sign/', '/storage/v1/object/photos/')
        .replace('/storage/v1/object/public/', '/storage/v1/object/photos/');
    return `https://${url.hostname}${normalizedPath}`;
}

async function emergencyEvictMediaCache(cache) {
    try {
        const keys = await cache.keys();
        // 手机端存储配额告警时，主动释放 40% 的旧缓存腾出空间
        const evictCount = Math.max(1, Math.floor(keys.length * 0.4));
        for (let i = 0; i < evictCount; i++) {
            await cache.delete(keys[i]);
        }
    } catch (err) {
        console.warn('Emergency evict media cache failed:', err);
    }
}

async function trimMediaCache(cache) {
    try {
        const keys = await cache.keys();
        if (keys.length > MAX_MEDIA_CACHE_ENTRIES) {
            const deleteCount = keys.length - MAX_MEDIA_CACHE_ENTRIES;
            for (let i = 0; i < deleteCount; i++) {
                await cache.delete(keys[i]);
            }
        }
    } catch (err) {
        console.warn('Trim media cache error:', err);
    }
}

async function cacheFirstStorageMedia(request) {
    const url = new URL(request.url);
    const canonicalKey = getCanonicalMediaKey(url);
    const cache = await caches.open(MEDIA_CACHE_NAME);

    const cached = await cache.match(canonicalKey);
    if (cached) return cached;

    try {
        let response;
        try {
            response = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
        } catch (_corsErr) {
            response = await fetch(request);
        }

        // 仅在完整成功 (HTTP 200) 时写入缓存，杜绝 206 Partial Content 等非完整响应
        if (response && response.status === 200) {
            // 写入本地媒体缓存，保证后续加载 0ms 命中
            cache.put(canonicalKey, response.clone()).then(() => {
                trimMediaCache(cache);
            }).catch(async (putErr) => {
                if (putErr && putErr.name === 'QuotaExceededError') {
                    await emergencyEvictMediaCache(cache);
                    try {
                        await cache.put(canonicalKey, response.clone());
                    } catch (_) {}
                } else {
                    console.warn('Cache media put failed:', putErr);
                }
            });
        }
        return response;
    } catch (networkError) {
        if (cached) return cached;
        throw networkError;
    }
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // 针对 Supabase 静态图片执行 Cache-First 极速缓存，音视频与流媒体直连放行
    if (isCacheableStorageImage(request, url)) {
        event.respondWith(cacheFirstStorageMedia(request));
        return;
    }

    // 非同源其他请求保持直连
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    const canonicalUrl = PRECACHE_BY_PATH.get(url.pathname);
    if (!canonicalUrl) return;

    event.respondWith(cacheFirstShell(request, canonicalUrl));
});
