const CACHE_PREFIX = 'love-diary-';
const CACHE_NAME = 'love-diary-v3.9.43';
const MEDIA_CACHE_NAME = 'love-diary-media-v1';
const MAX_MEDIA_CACHE_ENTRIES = 250;

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

function isSupabaseStorageMedia(url) {
    return url.hostname === 'tveiegolbotlqpjpwpes.supabase.co'
        && url.pathname.startsWith('/storage/v1/object/');
}

function getCanonicalMediaKey(url) {
    // 规范化路径并剥离短期鉴权 token 参数，以持久化命中本地缓存
    const normalizedPath = url.pathname
        .replace('/storage/v1/object/sign/', '/storage/v1/object/photos/')
        .replace('/storage/v1/object/public/', '/storage/v1/object/photos/');
    return `https://${url.hostname}${normalizedPath}`;
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
        if (response && (response.ok || response.type === 'opaque')) {
            // 写入本地媒体缓存，保证后续加载 0ms 命中
            cache.put(canonicalKey, response.clone()).then(() => {
                trimMediaCache(cache);
            }).catch(e => console.warn('Cache media put failed:', e));
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

    // 针对 Supabase 照片/音频/视频等静态媒体执行 Cache-First 极速缓存
    if (isSupabaseStorageMedia(url)) {
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
