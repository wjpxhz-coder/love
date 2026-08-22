// ==========================================
// 系统设置模块 (js/settings.js)
// ==========================================

function openSettingsModal() {
    if (typeof appNavigate === 'function') {
        appNavigate('/settings');
        return;
    }
    window.location.hash = '#/settings';
}

function enterSettingsPage() {
    if (!isAuthenticated()) return;

    const versionElement = document.getElementById('settingsVersion');
    if (versionElement && typeof APP_VERSION !== 'undefined') {
        versionElement.textContent = `当前版本：${APP_VERSION}`;
    }

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    if (typeof updateSettingsThemeButtons === 'function') {
        updateSettingsThemeButtons(currentTheme);
    }
    if (typeof syncAIPrivacySetting === 'function') syncAIPrivacySetting();
    const reminderMessage = document.getElementById('mood-reminder-message');
    if (reminderMessage) reminderMessage.textContent = '';
    if (typeof loadMoodReminderSettings === 'function') {
        applyMoodReminderSettingsToForm();
        loadMoodReminderSettings({ syncForm: true });
    }
    if (typeof updatePhotoCacheSizeDisplay === 'function') {
        updatePhotoCacheSizeDisplay();
    }
}

function closeSettingsModal() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function formatStorageBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function getPhotoCacheSize() {
    if (!('caches' in window)) return { bytes: 0, count: 0 };
    try {
        const hasCache = await caches.has('love-diary-media-v1');
        if (!hasCache) return { bytes: 0, count: 0 };

        const cache = await caches.open('love-diary-media-v1');
        const requests = await cache.keys();
        if (!requests || requests.length === 0) return { bytes: 0, count: 0 };

        let totalBytes = 0;
        await Promise.all(
            requests.map(async req => {
                try {
                    const res = await cache.match(req);
                    if (!res) return;
                    const contentLength = res.headers.get('content-length');
                    if (contentLength && !isNaN(parseInt(contentLength, 10))) {
                        totalBytes += parseInt(contentLength, 10);
                    } else {
                        const blob = await res.clone().blob();
                        totalBytes += blob.size;
                    }
                } catch (_err) {}
            })
        );
        return { bytes: totalBytes, count: requests.length };
    } catch (e) {
        console.warn('获取照片缓存大小异常:', e);
        return { bytes: 0, count: 0 };
    }
}

async function updatePhotoCacheSizeDisplay() {
    const displayEl = document.getElementById('photoCacheSizeDisplay');
    if (!displayEl) return;

    displayEl.textContent = '计算中...';
    try {
        const { bytes, count } = await getPhotoCacheSize();
        if (count === 0 || bytes === 0) {
            displayEl.textContent = '0 B';
        } else {
            displayEl.textContent = formatStorageBytes(bytes);
        }
    } catch (_e) {
        displayEl.textContent = '0 B';
    }
}

async function clearWebCache() {
    const confirmed = window.confirm('确定要清除网页缓存并重新加载吗？\n将刷新网站获取最新功能与页面更新，不会删除已缓存的照片，登录状态也会保留。');
    if (!confirmed) return;

    if (typeof showToast === 'function') showToast('正在清除网页缓存并重新加载... 🧹');

    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith('love-diary-') && key !== 'love-diary-media-v1')
                    .map(key => caches.delete(key))
            );
        } catch (error) {
            console.error('清理网页缓存失败:', error);
        }
    }

    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.update();
            }
        } catch (_e) {}
    }

    // 保留 Supabase Auth 会话和主题，只移除应用派生缓存。
    if (typeof clearUserLocalState === 'function') clearUserLocalState();
    localStorage.removeItem('last_seen_version');
    setTimeout(() => window.location.reload(), 500);
}

async function clearPhotoCache() {
    const confirmed = window.confirm('确定要清理本地照片缓存吗？\n清理后再次查看照片将重新从云端下载。');
    if (!confirmed) return;

    if (typeof showToast === 'function') showToast('正在清理本地照片缓存... 🖼️');

    if ('caches' in window) {
        try {
            await caches.delete('love-diary-media-v1');
        } catch (error) {
            console.error('清理照片缓存失败:', error);
        }
    }

    // 清理 sessionStorage 中的媒体临时签名链接缓存
    try {
        const sessionKeysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('signed_media_url_')) {
                sessionKeysToRemove.push(k);
            }
        }
        sessionKeysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_e) {}

    if (typeof signedMediaUrlCache !== 'undefined' && signedMediaUrlCache.clear) {
        signedMediaUrlCache.clear();
    }

    await updatePhotoCacheSizeDisplay();

    if (typeof showToast === 'function') showToast('本地照片缓存已清理完毕 ✨');
}

async function clearSpaceCache() {
    return clearWebCache();
}

function doSettingsLogout() {
    if (typeof forcePublicHomeRoute === 'function') forcePublicHomeRoute();
    if (typeof doLogout === 'function') doLogout();
}
