// ==========================================
// 认证与私密 UI 状态
// ==========================================

let currentAuthor = '';
let currentAuthUser = null;
let authEpoch = 0;
let authStateSubscription = null;
let authHydrationPromise = null;
let authHydrationUserId = null;
let authHydrationGeneration = 0;
let authResetGeneration = 0;
let authResetPromise = null;
let initialAuthCheckComplete = false;

let pendingDeleteId = null;
let pendingCommentMomentId = null;
let pendingDeleteCommentId = null;
let pendingDeleteCommentMomentId = null;

// 只在真实 Supabase Auth 会话建立后填充，不再持久化到 localStorage。
let allProfilesCache = {};

function isAuthenticated() {
    return Boolean(currentAuthUser && currentAuthor);
}

function hasAuthContext() {
    return Boolean(currentAuthUser && currentAuthor);
}

function getAuthEpoch() {
    return typeof authEpoch === 'number' ? authEpoch : 0;
}

function isCurrentAuthSnapshot(epoch, userId) {
    return epoch === authEpoch && currentAuthUser?.id === userId;
}


async function fetchAllProfiles() {
    if (!currentAuthUser) return [];

    const epoch = authEpoch;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('user_id, space_id, username, nickname, bio, avatar_url, avatar_path, updated_at');

        if (error) throw error;
        const rows = data || [];
        if (typeof batchResolveMediaUrls === 'function' && rows.length > 0) {
            const avatarRefs = rows
                .map(p => (typeof toAvatarMediaRef === 'function' ? toAvatarMediaRef(p?.avatar_path) : ''))
                .filter(Boolean);
            if (avatarRefs.length > 1) {
                await batchResolveMediaUrls(avatarRefs);
            }
        }
        if (typeof hydrateProfileAvatar === 'function') {
            await Promise.all(rows.map(profile => {
                if (currentUserProfile
                    && profile.user_id === currentUserProfile.user_id
                    && profile.avatar_path === currentUserProfile.avatar_path
                    && currentUserProfile._avatarResolvedUrl) {
                    profile._avatarResolvedUrl = currentUserProfile._avatarResolvedUrl;
                    profile._avatarResolvedPath = currentUserProfile.avatar_path;
                    return Promise.resolve(profile);
                }
                return hydrateProfileAvatar(profile);
            }));
        }
        if (epoch !== authEpoch || !currentAuthUser) return [];

        allProfilesCache = {};
        rows.forEach(profile => {
            if (profile.username) allProfilesCache[profile.username] = profile;
        });
        return rows;
    } catch (error) {
        console.error('加载成员资料失败:', error);
        return [];
    }
}

async function resolveAuthenticatedProfile(user) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('user_id, space_id, username, nickname, bio, avatar_url, avatar_path, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();

    if (error) throw error;
    if (!data || !data.username) {
        throw new Error('当前 Auth 用户尚未绑定情侣空间资料');
    }
    if (typeof hydrateProfileAvatar === 'function') await hydrateProfileAvatar(data);
    return data;
}

async function establishAuthenticatedUser(user, isNewLogin = false) {
    if (!user) return;

    if (authHydrationPromise && authHydrationUserId === user.id) {
        return authHydrationPromise;
    }
    if (currentAuthUser?.id === user.id && currentAuthor) {
        currentAuthUser = user;
        return;
    }

    authResetGeneration += 1;
    authEpoch += 1;
    const epoch = authEpoch;
    const hydrationGeneration = ++authHydrationGeneration;
    currentAuthUser = user;
    authHydrationUserId = user.id;

    const hydrationPromise = (async () => {
        try {
            const profilesList = await fetchAllProfiles();
            if (epoch !== authEpoch || currentAuthUser?.id !== user.id) return;

            let profile = Array.isArray(profilesList)
                ? profilesList.find(p => p && p.user_id === user.id && p.username)
                : null;
            if (!profile) {
                profile = await resolveAuthenticatedProfile(user);
                if (epoch !== authEpoch || currentAuthUser?.id !== user.id) return;
                allProfilesCache[profile.username] = profile;
            }

            currentAuthor = profile.username;
            currentUserProfile = profile;

            await onLoginSuccess(currentAuthor, isNewLogin);
        } catch (error) {
            if (epoch !== authEpoch || currentAuthUser?.id !== user.id) return;
            if (currentAuthor) {
                console.error('登录后界面初始化失败:', error);
                if (typeof showToast === 'function') {
                    showToast('账号已登录，但部分内容加载失败，请刷新后重试。', 5000);
                }
                return;
            }
            console.error('认证用户资料初始化失败:', error);
            const errorElement = document.getElementById('login-error');
            const message = '账号已登录，但尚未绑定情侣空间资料。请先完成数据库 Auth 迁移。';
            if (errorElement) errorElement.textContent = message;
            if (typeof showToast === 'function') showToast(message, 5000);
            await supabaseClient.auth.signOut({ scope: 'local' });
            await resetAuthenticatedUI();
        } finally {
            if (authHydrationGeneration === hydrationGeneration) {
                authHydrationPromise = null;
                authHydrationUserId = null;
            }
        }
    })();

    authHydrationPromise = hydrationPromise;
    return authHydrationPromise;
}

async function initAuth() {
    showPendingUI();
    localStorage.removeItem('lover_identity');
    localStorage.removeItem('all_profiles_cache');

    if (!supabaseClient) {
        const message = '登录服务未加载。请检查网络连接后刷新页面；离线时仍可打开应用外壳，但私密内容保持锁定。';
        const errorElement = document.getElementById('login-error');
        if (errorElement) errorElement.textContent = message;
        document.getElementById('login-trigger-btn')?.setAttribute('title', message);
        console.warn(message);
        initialAuthCheckComplete = true;
        showLockedUI();
        return;
    }

    const { data, error } = await supabaseClient.auth.getUser();
    if (error) {
        const sessionMissing = error.name === 'AuthSessionMissingError'
            || /session missing/i.test(error.message || '');
        if (!sessionMissing) console.error('读取登录会话失败:', error);
    } else if (data?.user) {
        await establishAuthenticatedUser(data.user, false);
    }
    initialAuthCheckComplete = true;
    if (!isAuthenticated()) showLockedUI();

    if (!authStateSubscription) {
        const { data: listener } = supabaseClient.auth.onAuthStateChange((event, session) => {
            // 避免在 Supabase auth 回调内部同步发起新的 Supabase 请求。
            setTimeout(() => {
                if (event === 'SIGNED_OUT' || !session?.user) {
                    resetAuthenticatedUI();
                    return;
                }
                if (['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
                    const isAlreadySameUser = Boolean(currentAuthUser?.id === session.user.id && currentAuthor);
                    if (isAlreadySameUser) {
                        currentAuthUser = session.user;
                        return;
                    }
                    establishAuthenticatedUser(session.user, event === 'SIGNED_IN');
                }
            }, 0);
        });
        authStateSubscription = listener?.subscription || null;
    }
}

function openLoginModal(returnTo = '') {
    const target = returnTo
        ? `/login?return=${encodeURIComponent(returnTo)}`
        : '/login';
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

function setLoginErrorMessage(message) {
    const errorElement = document.getElementById('login-error');
    if (!errorElement) return;
    const text = String(message || '');
    errorElement.textContent = text;
    if (!text) {
        errorElement.classList.remove('is-shaking');
        errorElement.style.animation = '';
        return;
    }
    const reducedMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;
    errorElement.classList.remove('is-shaking');
    errorElement.style.animation = 'none';
    void errorElement.offsetWidth;
    errorElement.style.animation = '';
    errorElement.classList.add('is-shaking');
}

function enterLoginPage() {
    const emailInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');

    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    setLoginErrorMessage('');

    const activateAfterTransition = () => {
        if (typeof isAppRouteActive === 'function' && !isAppRouteActive('login')) return;
        startLoginCanvas();
        const isMobile = typeof isTouchMobileViewport === 'function'
            ? isTouchMobileViewport()
            : window.matchMedia?.('(pointer: coarse)')?.matches;
        if (!isMobile) {
            emailInput?.focus({ preventScroll: true });
        }
    };
    if (typeof onAppRouteTransitionIdle === 'function') {
        onAppRouteTransitionIdle(activateAfterTransition);
    } else {
        activateAfterTransition();
    }
}

function leaveLoginPage() {
    stopLoginCanvas();
}

function closeLoginModal() {
    if (isAuthenticated() && typeof completeLoginNavigation === 'function') {
        completeLoginNavigation();
        return;
    }
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function toggleLoginPwEye() {
    const passwordInput = document.getElementById('login-password');
    const button = document.getElementById('login-pw-eye');
    if (!passwordInput || !button) return;

    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    button.textContent = showing ? '👁' : '🙈';
    button.setAttribute('aria-label', showing ? '显示密码' : '隐藏密码');
    button.setAttribute('aria-pressed', String(!showing));
}

async function doLogin() {
    const email = document.getElementById('login-username')?.value.trim() || '';
    const password = document.getElementById('login-password')?.value || '';
    const button = document.getElementById('login-btn');

    if (!supabaseClient) {
        setLoginErrorMessage('登录服务未加载，请联网后刷新页面。');
        return;
    }

    if (!email) {
        setLoginErrorMessage('请输入登录邮箱');
        return;
    }
    if (!password) {
        setLoginErrorMessage('请输入密码');
        return;
    }

    const originalText = button?.textContent || '进入我们的世界';
    if (button) {
        button.textContent = '登录中…';
        button.disabled = true;
    }
    setLoginErrorMessage('');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error || !data?.user) throw error || new Error('未返回登录用户');

        await establishAuthenticatedUser(data.user, true);
        if (isAuthenticated()) closeLoginModal();
    } catch (error) {
        console.error('登录失败:', error);
        setLoginErrorMessage('登录失败，请检查邮箱、密码和网络后重试。');
    } finally {
        if (button) {
            button.textContent = originalText;
            button.disabled = false;
        }
    }
}

async function onLoginSuccess(username, isNewLogin) {
    document.getElementById('login-trigger-btn')?.style.setProperty('display', 'none');
    const avatarButton = document.getElementById('user-avatar-btn');
    if (avatarButton) avatarButton.style.display = 'flex';
    const nameLabel = document.getElementById('user-name-label');
    if (nameLabel) nameLabel.textContent = `@${username}`;

    if (!currentUserProfile && typeof loadUserProfile === 'function') {
        await loadUserProfile(username);
    } else if (typeof updateAvatarButton === 'function') {
        updateAvatarButton();
    }

    hideLockedUI();

    // 建立 Realtime 在线与同频监听（后台并行执行，不再阻塞关键渲染）
    if (typeof initPresence === 'function') {
        initPresence().catch(err => console.warn('初始化 Presence 失败:', err));
    }

    const loaders = [];
    if (typeof fetchMoments === 'function') loaders.push(fetchMoments());
    if (typeof loadMoods === 'function') loaders.push(loadMoods());
    if (typeof loadNotifications === 'function') loaders.push(loadNotifications());
    if (typeof loadHomeTopics === 'function') loaders.push(loadHomeTopics());
    await Promise.allSettled(loaders);

    const routerWasInitialized = typeof isAppRouterInitialized === 'function'
        ? isAppRouterInitialized()
        : true;
    const activeRoute = typeof getCurrentAppRoute === 'function' ? getCurrentAppRoute() : null;
    if (routerWasInitialized && activeRoute && activeRoute.id !== 'home' && activeRoute.id !== 'login' && typeof onAppRouteEnter === 'function') {
        try {
            onAppRouteEnter(activeRoute);
        } catch (err) {
            console.warn('登录后重新加载当前活跃页面失败:', err);
        }
    }

    // AI 上传文件后台维护清理：彻底移出主首屏链路，延后至空闲时段调度
    if (typeof cleanupStaleAIInputsForCurrentUser === 'function') {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => cleanupStaleAIInputsForCurrentUser());
        } else {
            setTimeout(cleanupStaleAIInputsForCurrentUser, 3500);
        }
    }

    if (isNewLogin && typeof spawnHearts === 'function') {
        spawnHearts(window.innerWidth / 2, window.innerHeight / 2);
    }

    // 保留原更新日志体验，但明确绕过 HTTP/Service Worker 缓存。
    setTimeout(async () => {
        if (!isAuthenticated()) return;
        try {
            const response = await fetch('./sw.js', { cache: 'no-store' });
            if (!response.ok) return;
            const source = await response.text();
            const match = source.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (!match?.[1]) return;

            const currentCacheVersion = match[1];
            const lastSeen = localStorage.getItem('last_seen_version');
            if (lastSeen && lastSeen !== currentCacheVersion && typeof showVersionModal === 'function') {
                const normalized = currentCacheVersion.replace('love-diary-', '');
                const useConfigLog = typeof APP_VERSION !== 'undefined'
                    && normalized === APP_VERSION.replace('love-diary-', '');
                showVersionModal(currentCacheVersion, useConfigLog);
            } else if (!lastSeen) {
                localStorage.setItem('last_seen_version', currentCacheVersion);
            }
        } catch (error) {
            console.error('自动检测更新失败:', error);
        }
    }, 1200);
}

function clearUserLocalState() {
    const keysToRemove = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key) continue;
        if (
            key === 'lover_identity'
            || key === 'all_profiles_cache'
            || key.startsWith('profile_')
            || key.startsWith('starred_moments_local_')
            || key.startsWith('sweet_diary_moment_draft_')
        ) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    if (typeof clearAllMomentDrafts === 'function') {
        clearAllMomentDrafts();
    }
    try {
        sessionStorage.removeItem('sweet_diary_timeline_snapshot');
        sessionStorage.removeItem('sweet_diary_home_scroll_y');
    } catch (_e) {}
}

function scrubPrivateDom() {
    if (typeof stopProfileParticles === 'function') stopProfileParticles();
    if (typeof closeLightbox === 'function') closeLightbox();

    const profileAvatar = document.getElementById('profile-avatar-wrap');
    if (profileAvatar) {
        profileAvatar.replaceChildren();
        const placeholder = document.createElement('div');
        placeholder.className = 'profile-avatar-placeholder';
        placeholder.textContent = '🌸';
        profileAvatar.appendChild(placeholder);
    }
    const editAvatar = document.getElementById('edit-avatar-circle');
    if (editAvatar) {
        editAvatar.replaceChildren();
        const placeholder = document.createElement('span');
        placeholder.className = 'avatar-ph';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.textContent = '🌸';
        editAvatar.appendChild(placeholder);
    }

    const textDefaults = {
        'profile-topbar-title': '我的主页',
        'profile-nickname': '',
        'profile-username': '',
        'profile-bio': '',
        'profile-about-bio': '',
        'profile-quote': '',
        'profile-about-birthday': '',
        'profile-about-location': '',
        'stat-posts': '0',
        'stat-photos': '0',
        'edit-msg': '',
        'momentModalMsg': '',
        'moodModalMsg': '',
        'mood-reminder-message': '',
        'moodSelectedHint': '请点击表情选择今天的心情'
    };
    Object.entries(textDefaults).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            element.classList.remove('active');
        }
    });

    ['edit-nickname', 'edit-bio', 'momentTextInput', 'moodNote', 'aiChatInput'].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.value = '';
    });
    const avatarInput = document.getElementById('avatar-file-input');
    if (avatarInput) avatarInput.value = '';
    const momentInput = document.getElementById('momentPhotoInput');
    if (momentInput) momentInput.value = '';
    const milestoneCheckbox = document.getElementById('momentIsMilestone');
    if (milestoneCheckbox) milestoneCheckbox.checked = false;
    const aiConsent = document.getElementById('ai-service-consent');
    if (aiConsent) aiConsent.checked = true;
    const moodReminderEnabled = document.getElementById('mood-reminder-enabled');
    if (moodReminderEnabled) moodReminderEnabled.checked = true;
    const moodReminderTime = document.getElementById('mood-reminder-time');
    if (moodReminderTime) {
        moodReminderTime.value = '21:00';
        moodReminderTime.disabled = false;
    }

    const momentTitle = document.getElementById('moment-modal-title');
    if (momentTitle) momentTitle.textContent = '✨ 发布动态';
    if (typeof selectedMoodScore !== 'undefined') selectedMoodScore = 0;
    document.querySelectorAll('.mood-emoji-btn').forEach(button => {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
    });

    ['milestonesContent', 'blindBoxContent', 'aiContentArea', 'aiChatMessages', 'mood-day-list', 'home-topics-content', 'topics-catalog-list', 'topic-messages-flow'].forEach(id => {
        document.getElementById(id)?.replaceChildren();
    });
    const topicSummaryBanner = document.getElementById('topic-summary-banner');
    if (topicSummaryBanner) {
        topicSummaryBanner.hidden = true;
        topicSummaryBanner.replaceChildren();
    }
    if (typeof resetTopicsStateOnLogout === 'function') resetTopicsStateOnLogout();
}

async function resetAuthenticatedUI() {
    if (authResetPromise && !currentAuthUser) return authResetPromise;

    const resetGeneration = ++authResetGeneration;
    authHydrationGeneration += 1;
    authHydrationPromise = null;
    authHydrationUserId = null;
    authEpoch += 1;
    currentAuthor = '';
    currentAuthUser = null;
    currentUserProfile = null;
    allProfilesCache = {};
    pendingDeleteId = null;
    pendingCommentMomentId = null;
    pendingDeleteCommentId = null;
    pendingDeleteCommentMomentId = null;

    clearUserLocalState();
    if (typeof clearSignedMediaCache === 'function') clearSignedMediaCache();
    if (typeof caches !== 'undefined' && caches?.delete) {
        caches.delete('love-diary-media-v1').catch(() => {});
    }
    if (typeof resetNotificationState === 'function') resetNotificationState();
    else if (typeof processedMissIds !== 'undefined') processedMissIds.clear();
    if (typeof resetMoodState === 'function') resetMoodState();
    const presenceCleanup = typeof cleanupPresence === 'function'
        ? cleanupPresence()
        : Promise.resolve();
    if (typeof resetMomentComposer === 'function') resetMomentComposer();
    if (typeof resetTopicsStateOnLogout === 'function') resetTopicsStateOnLogout();
    if (typeof clearAllCommentImageSelections === 'function') clearAllCommentImageSelections();
    if (typeof commentLoadRequests !== 'undefined') commentLoadRequests.clear();
    if (typeof clearPendingAvatar === 'function') clearPendingAvatar();
    if (typeof clearPrivateFeatureState === 'function') clearPrivateFeatureState();
    if (typeof resetMissYouRequestState === 'function') resetMissYouRequestState();
    scrubPrivateDom();

    window.currentBlindBoxMoment = null;
    if (typeof chatHistory !== 'undefined') chatHistory.length = 0;

    hideUserDropdown();
    document.getElementById('login-trigger-btn')?.style.setProperty('display', 'flex');
    document.getElementById('user-avatar-btn')?.style.setProperty('display', 'none');

    const avatarButton = document.getElementById('user-avatar-btn');
    if (avatarButton) {
        avatarButton.replaceChildren();
        const placeholder = document.createElement('div');
        placeholder.className = 'avatar-placeholder';
        placeholder.textContent = '🌸';
        avatarButton.appendChild(placeholder);
    }

    const timeline = document.getElementById('timeline-content');
    if (timeline) {
        timeline.replaceChildren();
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = '登录后查看甜蜜回忆';
        timeline.appendChild(empty);
    }
    document.getElementById('mood-heatmap')?.replaceChildren();
    const moodStatus = document.getElementById('mood-calendar-status');
    if (moodStatus) moodStatus.textContent = '';

    const notificationList = document.getElementById('notification-list');
    if (notificationList) {
        notificationList.replaceChildren();
        const empty = document.createElement('li');
        empty.className = 'notification-empty';
        empty.textContent = '暂无通知';
        notificationList.appendChild(empty);
    }
    document.getElementById('notification-badge')?.classList.remove('show');
    document.getElementById('notification-panel')?.classList.remove('show');
    document.getElementById('profile-page')?.classList.remove('is-active');
    document.getElementById('edit-profile-page')?.classList.remove('is-active');

    document.querySelectorAll('dialog[open]').forEach(dialog => {
        if (dialog.id === 'globalConfirmDialog') {
            dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
            return;
        }
        if (dialog.id === 'versionModal' && typeof window.closeVersionModal === 'function') {
            window.closeVersionModal();
            return;
        }
        if (typeof window.hideTopicModal === 'function' && dialog.classList.contains('topic-modal-dialog')) {
            window.hideTopicModal(dialog);
        } else {
            dialog.classList.remove('is-open', 'is-closing');
            try {
                dialog.close();
            } catch (_e) {
                dialog.removeAttribute('open');
            }
        }
        if (dialog.id) {
            window.unlockBodyScroll?.(`topic-modal:${dialog.id}`);
            window.unlockBodyScroll?.(dialog.id);
        }
    });
    if (typeof closeLightbox === 'function' && document.getElementById('lightbox')?.classList.contains('show')) {
        closeLightbox();
    }
    window.unlockBodyScroll?.('lightbox');
    window.unlockBodyScroll?.('topic-modal');
    window.unlockBodyScroll?.('confirm-dialog');
    window.unlockBodyScroll?.('version-modal');
    window.unlockBodyScroll?.('modal');
    showLockedUI();

    const activeRoute = typeof getCurrentAppRoute === 'function' ? getCurrentAppRoute() : null;
    if (activeRoute?.protected && typeof forcePublicHomeRoute === 'function') {
        forcePublicHomeRoute();
    }

    const resetPromise = (async () => {
        await presenceCleanup;
        // All private DOM was cleared synchronously above. The generation check
        // prevents this retired reset task from doing future work after re-login.
        if (resetGeneration !== authResetGeneration || currentAuthUser) return;
    })();
    authResetPromise = resetPromise;
    try {
        await resetPromise;
    } finally {
        if (authResetPromise === resetPromise) authResetPromise = null;
    }
}

async function doLogout() {
    try {
        if (typeof cleanupActiveAIUploadsBeforeLogout === 'function') {
            await cleanupActiveAIUploadsBeforeLogout();
        }
        await supabaseClient.auth.signOut({ scope: 'local' });
    } catch (error) {
        console.error('退出登录失败:', error);
    } finally {
        await resetAuthenticatedUI();
    }
}

function toggleUserDropdown() {
    if (!isAuthenticated()) return;
    if (typeof openProfilePage === 'function') {
        openProfilePage();
    }
}

function hideUserDropdown() {
    // 保留向后兼容空实现
}

// ── 登录页景深氛围画布（统一复用现代景深粒子引擎，告别 Emoji 下雨并自动适配缩放与后台挂起） ──
let loginAmbientController = null;

function ensureLoginAmbientController() {
    if (loginAmbientController) return loginAmbientController;
    const canvas = document.getElementById('login-canvas');
    if (!canvas || typeof window.createAtmosphericCanvasController !== 'function') return null;

    loginAmbientController = window.createAtmosphericCanvasController(canvas, {
        desktopCount: 24,
        mobileCount: 14,
        lightDesktopCount: 9,
        lightMobileCount: 6,
        enablePointerWind: false,
        scrollThrottle: false,
        initialRouteActive: false,
        alwaysDarkTone: false,
        baseWind: 0.78
    });

    if (loginAmbientController && typeof window.registerAmbientController === 'function') {
        window.registerAmbientController(loginAmbientController);
    }
    return loginAmbientController;
}

function startLoginCanvas() {
    const ctrl = ensureLoginAmbientController();
    if (!ctrl) return;
    const ambient = document.documentElement.getAttribute('data-ambient') || 'dream';
    ctrl.setAmbientMode(ambient);
    ctrl.setRouteActive(true);
}

function stopLoginCanvas() {
    if (!loginAmbientController) return;
    loginAmbientController.setRouteActive(false);
}

// ── 受保护动作 ──
function checkPassword(actionType) {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    executeAction(actionType);
}

function executeAction(actionType) {
    if (!isAuthenticated()) return;
    if (actionType === 'moment') openMomentModal();
    else if (actionType === 'delete') deleteMoment(pendingDeleteId);
    else if (actionType === 'mood') openMoodModal();
    else if (actionType === 'comment') showCommentInput(pendingCommentMomentId);
    else if (actionType === 'delete_comment') deleteComment(pendingDeleteCommentId, pendingDeleteCommentMomentId);
}

function setHomeAuthView(state) {
    const body = document.body;
    const skeleton = document.getElementById('home-auth-skeleton');
    const moodSection = document.getElementById('mood-section');
    const moodContent = document.getElementById('mood-unlocked-content');
    const moodLockedCard = document.getElementById('mood-locked-card');
    const topicsSection = document.getElementById('home-topics-section');
    const topicsContent = document.getElementById('home-topics-unlocked-content');
    const topicsLockedCard = document.getElementById('topics-locked-card');
    const actions = document.getElementById('main-btn-group');
    const timelineSection = document.getElementById('timeline-section');
    const timelineContent = document.getElementById('timeline-unlocked-content');
    const timelineLockedCard = document.getElementById('timeline-locked-card');
    const fab = document.getElementById('fab-container');

    if (body) {
        body.classList.toggle('auth-pending', state === 'pending');
        body.dataset.authState = state;
    }

    if (skeleton) skeleton.hidden = state !== 'pending';
    if (moodSection) moodSection.hidden = state === 'pending';
    if (moodContent) moodContent.hidden = state !== 'unlocked';
    if (moodLockedCard) moodLockedCard.hidden = state !== 'locked';
    if (topicsSection) topicsSection.hidden = state === 'pending';
    if (topicsContent) topicsContent.hidden = state !== 'unlocked';
    if (topicsLockedCard) topicsLockedCard.hidden = state !== 'locked';
    if (actions) actions.hidden = state !== 'unlocked';
    if (timelineSection) timelineSection.hidden = state === 'pending';
    if (timelineContent) timelineContent.hidden = state !== 'unlocked';
    if (timelineLockedCard) timelineLockedCard.hidden = state !== 'locked';
    if (fab) fab.style.setProperty('display', state === 'unlocked' ? 'flex' : 'none', 'important');
}

function showPendingUI() {
    setHomeAuthView('pending');
}

function showLockedUI() {
    if (!initialAuthCheckComplete) {
        showPendingUI();
        return;
    }
    setHomeAuthView('locked');
}

function hideLockedUI() {
    const moodContent = document.getElementById('mood-unlocked-content');
    const mainButtons = document.getElementById('main-btn-group');
    const timelineContent = document.getElementById('timeline-unlocked-content');

    initialAuthCheckComplete = true;
    setHomeAuthView('unlocked');
    if (moodContent) {
        moodContent.classList.add('fade-in-section');
    }
    if (mainButtons) {
        mainButtons.classList.add('fade-in-section');
    }
    if (timelineContent) {
        timelineContent.classList.add('fade-in-section');
    }
}

document.getElementById('login-password')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') doLogin();
});
document.getElementById('login-username')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') document.getElementById('login-password')?.focus();
});
