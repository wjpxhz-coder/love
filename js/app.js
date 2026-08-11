async function initializeApp() {
    initTheme();
    createStarField();
    renderAnniversaries();
    initAccessibleUiState();
    setTimeout(initCardGlow, 600);

    // 脚本位于页面底部，DOM 就绪后立即恢复会话，避免等待图片和字体加载完成。
    if (typeof showPendingUI === 'function') showPendingUI();

    await initAuth();
    if (typeof initAppRouter === 'function') {
        const route = initAppRouter();
        if (
            route?.id === 'login'
            && typeof isAuthenticated === 'function'
            && isAuthenticated()
            && typeof completeLoginNavigation === 'function'
        ) {
            completeLoginNavigation();
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
    initializeApp();
}
// ==========================================
// 注册 Service Worker (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('./sw.js', {
                updateViaCache: 'none'
            });

            const activateUpdate = worker => {
                if (!worker || !navigator.serviceWorker.controller) return;
                showToast('发现新版本，正在完成更新…');
                worker.postMessage({ type: 'SKIP_WAITING' });
            };

            if (registration.waiting) activateUpdate(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                if (!worker) return;
                worker.addEventListener('statechange', () => {
                    if (worker.state === 'installed') activateUpdate(worker);
                });
            });

            // Check the worker script without cache-busting query strings.
            await registration.update();
        } catch (error) {
            console.warn('Service Worker registration failed:', error);
        }
    }, { once: true });
}

function initAccessibleUiState() {
    const classBindings = [
        { target: 'user-dropdown', control: 'user-avatar-btn', activeClass: 'show' },
        { target: 'notification-panel', control: 'notification-bell', activeClass: 'show' },
        { target: 'fab-menu', control: 'fab-main', activeClass: 'show' },
        { target: 'profile-page', activeClass: 'is-active' },
        { target: 'edit-profile-page', activeClass: 'is-active' },
        { target: 'lightbox', activeClass: 'show' }
    ];

    classBindings.forEach(({ target, control, activeClass }) => {
        const targetElement = document.getElementById(target);
        const controlElement = control ? document.getElementById(control) : null;
        if (!targetElement) return;

        const syncState = () => {
            const isActive = targetElement.classList.contains(activeClass);
            targetElement.setAttribute('aria-hidden', String(!isActive));
            if (controlElement) controlElement.setAttribute('aria-expanded', String(isActive));
        };
        syncState();
        new MutationObserver(syncState).observe(targetElement, { attributes: true, attributeFilter: ['class'] });
    });

    const syncSelectedState = selector => {
        document.querySelectorAll(selector).forEach(element => {
            const syncState = () => {
                const isSelected = element.classList.contains('active') || element.classList.contains('selected');
                element.setAttribute(element.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-pressed', String(isSelected));
            };
            syncState();
            new MutationObserver(syncState).observe(element, { attributes: true, attributeFilter: ['class'] });
        });
    };

    syncSelectedState('.ai-tab, .mood-emoji-btn, .theme-opt-btn');

    const passwordToggle = document.getElementById('login-pw-eye');
    const passwordInput = document.getElementById('login-password');
    if (passwordToggle && passwordInput) {
        const syncPasswordToggle = () => {
            const isVisible = passwordInput.type === 'text';
            passwordToggle.setAttribute('aria-pressed', String(isVisible));
            passwordToggle.setAttribute('aria-label', isVisible ? '隐藏密码' : '显示密码');
        };
        syncPasswordToggle();
        new MutationObserver(syncPasswordToggle).observe(passwordInput, { attributes: true, attributeFilter: ['type'] });
    }

    const versionModal = document.getElementById('versionModal');
    versionModal?.addEventListener('cancel', event => {
        event.preventDefault();
        closeVersionModal();
    });
}

function onAppRouteEnter(route) {
    if (!route) return;
    window.homeSakuraEffect?.setRouteActive(route.id === 'home');
    if (route.id === 'login' && typeof enterLoginPage === 'function') enterLoginPage(route);
    else if (route.id === 'moment' && typeof enterMomentPage === 'function') enterMomentPage(route);
    else if (route.id === 'mood' && typeof enterMoodPage === 'function') enterMoodPage(route);
    else if (route.id === 'mood-day' && typeof enterMoodDayPage === 'function') enterMoodDayPage(route);
    else if (route.id === 'filter' && typeof enterFilterPage === 'function') enterFilterPage(route);
    else if (route.id === 'blindbox' && typeof enterBlindBoxPage === 'function') enterBlindBoxPage(route);
    else if (route.id === 'ai' && typeof enterAIPage === 'function') enterAIPage(route);
    else if (route.id === 'ai-chat' && typeof enterAIChatPage === 'function') enterAIChatPage(route);
    else if (route.id === 'settings' && typeof enterSettingsPage === 'function') enterSettingsPage(route);
    else if (route.id === 'milestones' && typeof enterMilestonesPage === 'function') enterMilestonesPage(route);
    else if (route.id === 'profile' && typeof enterProfilePage === 'function') enterProfilePage(route);
    else if (route.id === 'edit-profile' && typeof enterEditProfilePage === 'function') enterEditProfilePage(route);
}

function onAppRouteLeave(route) {
    if (!route) return;
    // Restore the current route's inert snapshot before the router applies the
    // next route, otherwise a lightbox opened during history navigation can
    // overwrite the new page's interaction state.
    const lightbox = document.getElementById('lightbox');
    if (lightbox?.classList.contains('show') && typeof closeLightbox === 'function') {
        closeLightbox();
    }
    if (route.id === 'login' && typeof leaveLoginPage === 'function') leaveLoginPage();
    else if (route.id === 'moment' && typeof leaveMomentPage === 'function') leaveMomentPage();
    else if (route.id === 'mood' && typeof leaveMoodPage === 'function') leaveMoodPage();
    else if (route.id === 'mood-day' && typeof leaveMoodDayPage === 'function') leaveMoodDayPage();
    else if (route.id === 'blindbox' && typeof leaveBlindBoxPage === 'function') leaveBlindBoxPage();
    else if (route.id === 'ai' && typeof leaveAIPage === 'function') leaveAIPage();
    else if (route.id === 'ai-chat' && typeof leaveAIChatPage === 'function') leaveAIChatPage();
    else if (route.id === 'profile' && typeof leaveProfilePage === 'function') leaveProfilePage();
    else if (route.id === 'edit-profile' && typeof leaveEditProfilePage === 'function') leaveEditProfilePage();
}

function canLeaveAppRoute(route) {
    if (!route) return true;
    if (route.id === 'moment' && typeof isMomentSubmitting !== 'undefined' && isMomentSubmitting) {
        const message = document.getElementById('momentModalMsg');
        if (message) message.textContent = '正在发布，请稍候…';
        return false;
    }
    if (route.id === 'mood' && typeof isMoodSaving !== 'undefined' && isMoodSaving) return false;
    if (route.id === 'edit-profile' && typeof isProfileSaving !== 'undefined' && isProfileSaving) {
        if (typeof showToast === 'function') showToast('资料正在保存，请稍候…');
        return false;
    }
    return true;
}

let tempTargetVersionToSave = '';

function showVersionModal(versionName, useConfigLog = true) {
    const modal = document.getElementById('versionModal');
    if (!modal) return;

    tempTargetVersionToSave = versionName || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');

    // 格式化版本号展示 (如 love-diary-v3.3.0 -> v3.3.0)
    let displayVersion = versionName || '';
    if (displayVersion.includes('love-diary-')) {
        displayVersion = displayVersion.replace('love-diary-', '');
    }

    const verNumEl = document.getElementById('versionNumber');
    const verDateEl = document.getElementById('versionDate');
    const verTitleEl = document.getElementById('versionTitle');
    const list = document.getElementById('versionChangelogList');

    if (verNumEl) verNumEl.textContent = displayVersion || (typeof UPDATE_LOG !== 'undefined' ? UPDATE_LOG.version : 'latest');
    
    list.replaceChildren();

    if (useConfigLog && typeof UPDATE_LOG !== 'undefined') {
        if (verDateEl) verDateEl.textContent = `更新时间：${UPDATE_LOG.date}`;
        if (verTitleEl && UPDATE_LOG.title) verTitleEl.textContent = UPDATE_LOG.title;

        UPDATE_LOG.features.forEach(feat => {
            const li = document.createElement('li');
            li.textContent = feat;
            list.appendChild(li);
        });
    } else {
        // 自动降级：展示通用更新说明
        if (verDateEl) verDateEl.textContent = `检测到空间已更新 ✨`;
        if (verTitleEl) verTitleEl.textContent = '空间又升级啦 💖';

        const defaultFeats = [
            '空间已悄悄完成版本升级与体验优化 🛠️',
            '更新了部分缓存资源，日常访问更加流畅 🚀',
            '修复了一些小细节，快去体验一下吧！✨'
        ];
        defaultFeats.forEach(feat => {
            const li = document.createElement('li');
            li.textContent = feat;
            list.appendChild(li);
        });
    }

    modal.showModal();

    // 播放心形雨特效，增添浪漫感
    if (typeof createHeartRain === 'function') {
        setTimeout(createHeartRain, 300);
    }
}

function closeVersionModal() {
    const modal = document.getElementById('versionModal');
    if (modal) {
        modal.close();
    }
    // 保存已查看的版本号 (保存 SW 缓存名称作为唯一标识)
    if (tempTargetVersionToSave) {
        localStorage.setItem('last_seen_version', tempTargetVersionToSave);
    } else if (typeof APP_VERSION !== 'undefined') {
        localStorage.setItem('last_seen_version', APP_VERSION);
    }
}

