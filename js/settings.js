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
    if (typeof syncAIModelSetting === 'function') syncAIModelSetting();
    if (typeof loadSupportedModelsList === 'function') loadSupportedModelsList(false);
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
                    } else if (res.type !== 'opaque') {
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
    if (typeof clearSignedMediaCache === 'function') {
        clearSignedMediaCache();
    } else {
        try {
            const sessionKeysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && (k.startsWith('love_signed_media_') || k.startsWith('signed_media_url_'))) {
                    sessionKeysToRemove.push(k);
                }
            }
            sessionKeysToRemove.forEach(k => sessionStorage.removeItem(k));
        } catch (_e) {}

        if (typeof signedMediaUrlCache !== 'undefined' && signedMediaUrlCache.clear) {
            signedMediaUrlCache.clear();
        }
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

// --- 感情助手模型选择与动态拉取 ---
let isFetchingModels = false;

function syncAIModelSetting() {
    const select = document.getElementById('ai-model-select');
    const customWrap = document.getElementById('model-custom-wrapper');
    const customInput = document.getElementById('ai-model-custom-input');
    if (!select) return;

    const currentModel = typeof getStoredAIModel === 'function' ? getStoredAIModel() : 'agnes-2.0-flash';
    let hasOption = false;
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === currentModel) {
            select.selectedIndex = i;
            hasOption = true;
            break;
        }
    }

    if (!hasOption) {
        let customOpt = select.querySelector('option[value="__custom__"]');
        if (!customOpt) {
            customOpt = document.createElement('option');
            customOpt.value = '__custom__';
            customOpt.textContent = '✍️ 自定义其他模型...';
            select.appendChild(customOpt);
        }
        select.value = '__custom__';
        if (customWrap) customWrap.style.display = 'block';
        if (customInput) customInput.value = currentModel === 'agnes-2.0-flash' ? '' : currentModel;
    } else {
        if (customWrap) customWrap.style.display = 'none';
    }
}

async function loadSupportedModelsList(forceRefresh = false) {
    const select = document.getElementById('ai-model-select');
    const refreshBtn = document.getElementById('btn-refresh-models');
    if (!select || isFetchingModels) return;

    isFetchingModels = true;
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '拉取中…';
    }

    try {
        let modelList = [];
        if (typeof fetchSupportedModels === 'function') {
            modelList = await fetchSupportedModels();
        }

        if (!Array.isArray(modelList) || modelList.length === 0) {
            modelList = (typeof FALLBACK_AI_MODELS !== 'undefined' ? FALLBACK_AI_MODELS : []).map(m => m.id);
        }

        select.replaceChildren();

        const defaultOpt = document.createElement('option');
        defaultOpt.value = 'agnes-2.0-flash';
        defaultOpt.textContent = 'agnes-2.0-flash (极速默认)';
        select.appendChild(defaultOpt);

        const seenModels = new Set(['agnes-2.0-flash']);

        modelList.forEach(mId => {
            if (!mId || seenModels.has(mId)) return;
            seenModels.add(mId);
            const opt = document.createElement('option');
            opt.value = mId;
            let displayName = mId;
            if (mId === 'gpt-4o-mini') displayName = 'gpt-4o-mini (轻量智能)';
            else if (mId === 'gpt-4o') displayName = 'gpt-4o (全能旗舰)';
            else if (mId === 'gemini-2.0-flash') displayName = 'gemini-2.0-flash (谷歌极速)';
            else if (mId === 'claude-3-5-sonnet-20241022') displayName = 'claude-3-5-sonnet (思维深刻)';
            opt.textContent = displayName;
            select.appendChild(opt);
        });

        const customOpt = document.createElement('option');
        customOpt.value = '__custom__';
        customOpt.textContent = '✍️ 自定义其他模型...';
        select.appendChild(customOpt);

        syncAIModelSetting();

        if (forceRefresh && typeof showToast === 'function') {
            showToast('已更新感情助手支持的模型列表 ✨');
        }
    } catch (e) {
        console.warn('拉取模型列表异常:', e);
        if (forceRefresh && typeof showToast === 'function') {
            showToast('已加载推荐模型列表 🌸');
        }
    } finally {
        isFetchingModels = false;
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 刷新';
        }
    }
}

function handleAIModelSelectChange(val) {
    const customWrap = document.getElementById('model-custom-wrapper');
    const customInput = document.getElementById('ai-model-custom-input');
    if (val === '__custom__') {
        if (customWrap) customWrap.style.display = 'block';
        if (customInput) {
            customInput.focus();
            if (customInput.value.trim() && typeof setStoredAIModel === 'function') {
                setStoredAIModel(customInput.value.trim());
            }
        }
    } else {
        if (customWrap) customWrap.style.display = 'none';
        if (typeof setStoredAIModel === 'function') {
            setStoredAIModel(val);
        }
        if (typeof showToast === 'function') {
            showToast(`已切换模型为：${val} ✨`);
        }
    }
}

let customModelDebounceTimer = null;
function handleCustomModelInputChange(val) {
    clearTimeout(customModelDebounceTimer);
    customModelDebounceTimer = setTimeout(() => {
        const clean = String(val || '').trim();
        if (clean && typeof setStoredAIModel === 'function') {
            setStoredAIModel(clean);
        }
    }, 300);
}

window.syncAIModelSetting = syncAIModelSetting;
window.loadSupportedModelsList = loadSupportedModelsList;
window.handleAIModelSelectChange = handleAIModelSelectChange;
window.handleCustomModelInputChange = handleCustomModelInputChange;
