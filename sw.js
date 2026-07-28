const CACHE_PREFIX = 'love-diary-';
const CACHE_NAME = 'love-diary-v3.8.1';

// Only application-shell files are cached. Private API responses, user media,
// and third-party resources are deliberately excluded from this allow-list.
const PRECACHE_ASSETS = [
    './index.html',
    './manifest.json',
    './icon-192.png',
    './css/variables.css', './css/base.css', './css/header.css', './css/timer.css', './css/timeline.css',
    './css/dialogs.css', './css/comments.css', './css/ai-panel.css', './css/fab.css', './css/auth.css',
    './css/profile.css', './css/notifications.css', './css/mood.css', './css/anniversary.css',
    './css/effects.css', './css/responsive.css', './css/pages.css',
    './js/config.js', './js/animations.js', './js/timer.js', './js/auth.js', './js/profile.js',
    './js/moments.js', './js/milestones.js', './js/comments.js', './js/likes.js', './js/mood.js', './js/anniversary.js',
    './js/lightbox.js', './js/ai.js', './js/blindbox.js', './js/presence.js', './js/theme.js',
    './js/notifications.js', './js/effects.js', './js/router.js', './js/app.js'
];

const PRECACHE_URLS = PRECACHE_ASSETS.map(asset => new URL(asset, self.registration.scope).href);
const PRECACHE_BY_PATH = new Map(PRECACHE_URLS.map(url => [new URL(url).pathname, url]));
const OFFLINE_URL = new URL('./index.html', self.registration.scope).href;

async function precacheShell() {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(PRECACHE_URLS.map(async url => {
        const request = new Request(url, { cache: 'reload', credentials: 'same-origin' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`${response.status} ${url}`);
        await cache.put(request, response);
    }));

    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
        console.warn(`Service Worker: ${failed.length} shell asset(s) could not be precached.`, failed);
    }
}

self.addEventListener('install', event => {
    // Individual optional asset failures no longer make the whole installation fail.
    event.waitUntil(precacheShell());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map(key => caches.delete(key)));
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
            // Awaiting the write keeps it within the fetch event lifetime.
            await cache.put(OFFLINE_URL, response.clone());
            return response;
        }

        // Static hosts commonly answer deep links with 404. This is a single-page
        // application, so fall back to the cached shell for in-scope navigations.
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
        // Store one canonical key even if a caller supplied a cache-busting query.
        await cache.put(canonicalUrl, response.clone());
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Cross-origin dependencies and all API/user-content requests stay network-only.
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    const canonicalUrl = PRECACHE_BY_PATH.get(url.pathname);
    if (!canonicalUrl) return;

    event.respondWith(cacheFirstShell(request, canonicalUrl));
});
