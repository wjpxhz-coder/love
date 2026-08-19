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
}

function closeSettingsModal() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

async function clearSpaceCache() {
    const confirmed = window.confirm('确定要清理甜蜜记缓存并重新加载吗？登录状态和主题设置会保留。');
    if (!confirmed) return;

    if (typeof showToast === 'function') showToast('正在清理缓存并刷新空间... 🧹');

    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter(key => key.startsWith('love-diary-'))
                    .map(key => caches.delete(key))
            );
        } catch (error) {
            console.error('清理缓存失败:', error);
        }
    }

    // 保留 Supabase Auth 会话和主题，只移除应用派生缓存。
    if (typeof clearUserLocalState === 'function') clearUserLocalState();
    localStorage.removeItem('last_seen_version');
    setTimeout(() => window.location.reload(), 600);
}

function doSettingsLogout() {
    if (typeof forcePublicHomeRoute === 'function') forcePublicHomeRoute();
    if (typeof doLogout === 'function') doLogout();
}
