const CACHE_NAME = 'love-diary-v3.2.0';
const STATIC_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&family=Nunito:wght@400;500;600&display=swap',
    './css/variables.css', './css/base.css', './css/header.css', './css/timer.css', './css/timeline.css',
    './css/dialogs.css', './css/comments.css', './css/ai-panel.css', './css/fab.css', './css/auth.css',
    './css/profile.css', './css/notifications.css', './css/mood.css', './css/anniversary.css',
    './css/effects.css', './css/responsive.css',
    './js/config.js', './js/animations.js', './js/timer.js', './js/auth.js', './js/profile.js',
    './js/moments.js', './js/comments.js', './js/likes.js', './js/mood.js', './js/anniversary.js',
    './js/lightbox.js', './js/ai.js', './js/blindbox.js', './js/presence.js', './js/theme.js',
    './js/notifications.js', './js/effects.js', './js/app.js'
];

// 安装 — 缓存静态资源
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
    );
    self.skipWaiting();
});

// 激活 — 清理旧缓存
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// 请求拦截
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Supabase API 请求不缓存，直接走网络
    if (url.hostname.includes('supabase')) {
        return;
    }

    // HTML 页面 — 网络优先，离线时用缓存
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // 静态资源（JS、CSS、字体等）— 网络优先，离线时用缓存
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
