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
    if (!currentAuthUser) return;

    const epoch = authEpoch;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('user_id, space_id, username, nickname, bio, avatar_url, avatar_path, updated_at');

        if (error) throw error;
        if (typeof hydrateProfileAvatar === 'function') {
            await Promise.all((data || []).map(profile => hydrateProfileAvatar(profile)));
        }
        if (epoch !== authEpoch || !currentAuthUser) return;

        allProfilesCache = {};
        (data || []).forEach(profile => {
            if (profile.username) allProfilesCache[profile.username] = profile;
        });
    } catch (error) {
        console.error('加载成员资料失败:', error);
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
    if (currentAuthUser?.id === user.id && currentAuthor && !isNewLogin) return;

    authResetGeneration += 1;
    authEpoch += 1;
    const epoch = authEpoch;
    const hydrationGeneration = ++authHydrationGeneration;
    currentAuthUser = user;
    authHydrationUserId = user.id;

    const hydrationPromise = (async () => {
        try {
            const profile = await resolveAuthenticatedProfile(user);
            if (epoch !== authEpoch || currentAuthUser?.id !== user.id) return;

            currentAuthor = profile.username;
            currentUserProfile = profile;
            allProfilesCache = { [profile.username]: profile };
            await fetchAllProfiles();
            if (epoch !== authEpoch) return;

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

function enterLoginPage() {
    const emailInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorElement = document.getElementById('login-error');

    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (errorElement) errorElement.textContent = '';
    startLoginCanvas();
    setTimeout(() => emailInput?.focus(), 100);
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
    const errorElement = document.getElementById('login-error');
    const button = document.getElementById('login-btn');

    if (!supabaseClient) {
        if (errorElement) errorElement.textContent = '登录服务未加载，请联网后刷新页面。';
        return;
    }

    if (!email) {
        if (errorElement) errorElement.textContent = '请输入登录邮箱';
        return;
    }
    if (!password) {
        if (errorElement) errorElement.textContent = '请输入密码';
        return;
    }

    const originalText = button?.textContent || '进入我们的世界';
    if (button) {
        button.textContent = '登录中…';
        button.disabled = true;
    }
    if (errorElement) errorElement.textContent = '';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error || !data?.user) throw error || new Error('未返回登录用户');

        await establishAuthenticatedUser(data.user, true);
        if (isAuthenticated()) closeLoginModal();
    } catch (error) {
        console.error('登录失败:', error);
        if (errorElement) errorElement.textContent = '登录失败，请检查邮箱、密码和网络后重试。';
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

    if (typeof initPresence === 'function') await initPresence();

    const loaders = [];
    if (typeof fetchMoments === 'function') loaders.push(fetchMoments());
    if (typeof loadMoods === 'function') loaders.push(loadMoods());
    if (typeof loadNotifications === 'function') loaders.push(loadNotifications());
    if (typeof cleanupStaleAIInputsForCurrentUser === 'function') {
        loaders.push(cleanupStaleAIInputsForCurrentUser());
    }
    await Promise.allSettled(loaders);

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
        ) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
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

    ['milestonesContent', 'blindBoxContent', 'aiContentArea', 'aiChatMessages', 'mood-day-list'].forEach(id => {
        document.getElementById(id)?.replaceChildren();
    });
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
    if (typeof resetNotificationState === 'function') resetNotificationState();
    else if (typeof processedMissIds !== 'undefined') processedMissIds.clear();
    if (typeof resetMoodState === 'function') resetMoodState();
    const presenceCleanup = typeof cleanupPresence === 'function'
        ? cleanupPresence()
        : Promise.resolve();
    if (typeof resetMomentComposer === 'function') resetMomentComposer();
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
        dialog.close();
    });
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

// ── 登录弹窗粒子 (预渲染雪碧图 + 丝滑高刷) ──
let loginCanvasAnim = null;
const loginEmojis = ['💖', '💗', '💕', '✨', '🌸', '💝', '🌹', '🎀'];
const loginEmojiSpriteMap = {};

function getLoginEmojiSprite(emoji, size = 32) {
    const key = `${emoji}_${size}`;
    if (loginEmojiSpriteMap[key]) return loginEmojiSpriteMap[key];
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const canvas = document.createElement('canvas');
    const dim = Math.round((size + 8) * dpr);
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, (size + 8) / 2, (size + 8) / 2);
    loginEmojiSpriteMap[key] = { canvas, size: size + 8 };
    return loginEmojiSpriteMap[key];
}

function startLoginCanvas() {
    stopLoginCanvas();
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = document.getElementById('login-canvas');
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;

    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const petals = [];
    const count = window.innerWidth < 768 ? 16 : 28;
    for (let index = 0; index < count; index += 1) {
        petals.push({
            x: Math.random() * window.innerWidth,
            y: Math.random() * (window.innerHeight + 100) - 50,
            size: 14 + Math.random() * 18,
            speedY: 0.8 + Math.random() * 1.5,
            speedX: (Math.random() - 0.5) * 0.8,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.035,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.015 + Math.random() * 0.025,
            alpha: 0.55 + Math.random() * 0.4,
            emoji: loginEmojis[Math.floor(Math.random() * loginEmojis.length)]
        });
    }

    loginCanvasAnim = { running: true, requestId: null, lastTime: 0 };
    const animate = (timestamp) => {
        if (!loginCanvasAnim?.running) return;
        const dtSec = loginCanvasAnim.lastTime > 0
            ? Math.min((timestamp - loginCanvasAnim.lastTime) / 1000, 0.05)
            : 0.016;
        loginCanvasAnim.lastTime = timestamp;
        const step = dtSec * 60;

        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
        petals.forEach(petal => {
            petal.sway += petal.swaySpeed * step;
            petal.x += (petal.speedX + Math.sin(petal.sway) * 0.7) * step;
            petal.y += petal.speedY * step;
            petal.rot += petal.rotSpeed * step;
            if (petal.y > window.innerHeight + 35) {
                petal.y = -35;
                petal.x = Math.random() * window.innerWidth;
            }
            const spriteObj = getLoginEmojiSprite(petal.emoji, 28);
            if (spriteObj) {
                context.save();
                context.translate(petal.x, petal.y);
                context.rotate(petal.rot);
                context.globalAlpha = petal.alpha;
                const drawScale = petal.size / spriteObj.size;
                const half = spriteObj.size / 2;
                context.drawImage(
                    spriteObj.canvas,
                    -half * drawScale,
                    -half * drawScale,
                    spriteObj.size * drawScale,
                    spriteObj.size * drawScale
                );
                context.restore();
            }
        });
        if (loginCanvasAnim) loginCanvasAnim.requestId = requestAnimationFrame(animate);
    };
    loginCanvasAnim.requestId = requestAnimationFrame(animate);
}

function stopLoginCanvas() {
    if (!loginCanvasAnim) return;
    loginCanvasAnim.running = false;
    if (loginCanvasAnim.requestId) cancelAnimationFrame(loginCanvasAnim.requestId);
    loginCanvasAnim = null;
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
