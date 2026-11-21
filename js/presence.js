// ==========================================
// Supabase Realtime Presence（仅认证空间成员）
// ==========================================

let presenceChannel = null;
let presenceSpaceId = null;
let bothOnline = false;
let currentRouteId = 'home';
let currentPresenceActivity = '正在陪你看回忆 ✨';
let localPresenceStatus = 'active'; // 'active' | 'away'
let localAwaySince = 0;
let isUntrackedDueToAwayTimeout = false;
let lastPresenceTrackTime = 0;
let presenceTrackTimer = null;
let blurAwayTimer = null;
let idleAwayTimer = null;
let localAwayExpireTimer = null;
let partnerAwayExpireTimer = null;
let presenceLifecycleBound = false;
let lastInteractionVerifyTime = 0;
const partnerAwayObservedAt = new Map();

const PRESENCE_DEFAULT_ACTIVITY = '正在陪你看回忆 ✨';
const PRESENCE_AWAY_ACTIVITY = '暂时切出去了 📱';
const PRESENCE_BLUR_AWAY_DELAY_MS = 4500;
const PRESENCE_SUBPAGE_IDLE_MS = 40000;
const PRESENCE_HOME_IDLE_MS = 75000;
const PRESENCE_AWAY_EXPIRE_MS = 60000;

const PRESENCE_ROUTE_ACTIVITY_MAP = {
    home: '正在陪你看回忆 ✨',
    moment: '正在记录新动态 ✍️',
    mood: '正在记录心情日历 🌈',
    'mood-day': '正在记录心情日历 🌈',
    topics: '正在翻阅恋爱手账 📖',
    'topic-detail': '正在翻阅恋爱手账 📖',
    milestones: '正在重温大事记 🏆',
    blindbox: '正在抽取回忆盲盒 🎲',
    ai: '正在和感情小助手聊天 🤖',
    'ai-chat': '正在和感情小助手聊天 🤖',
    profile: '正在逛个人主页 🌸',
    'profile-moments': '正在逛个人主页 🌸',
    'profile-photos': '正在逛个人主页 🌸',
    'edit-profile': '正在逛个人主页 🌸',
    filter: '正在检索甜蜜回忆 🔍',
    settings: '正在调整空间设置 ⚙️'
};

function profileForUserId(userId) {
    return Object.values(allProfilesCache || {}).find(profile => profile.user_id === userId) || null;
}

function getPartnerProfile() {
    const myUserId = currentAuthUser?.id;
    const profiles = Object.values(allProfilesCache || {});
    if (myUserId) {
        const partner = profiles.find(p => p && p.user_id && p.user_id !== myUserId);
        if (partner) return partner;
    }
    if (typeof currentAuthor === 'string' && currentAuthor) {
        const partnerByAuthor = profiles.find(p => p && p.username && p.username !== currentAuthor);
        if (partnerByAuthor) return partnerByAuthor;
    }
    return null;
}

function syncHomeSakuraAppearance() {
    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    if (typeof window.syncAllAmbientEffects === 'function') {
        window.syncAllAmbientEffects({ theme, bothOnline });
    } else {
        window.homeSakuraEffect?.setAppearance({ theme, bothOnline });
    }
}

function updateResonanceBannerText(partnerName = 'TA', partnerActivity = PRESENCE_DEFAULT_ACTIVITY, isAway = false) {
    const ui = document.getElementById('resonance-ui');
    if (!ui) return;
    const fullEl = ui.querySelector('.resonance-text-full');
    const shortEl = ui.querySelector('.resonance-text-short');
    const safeName = partnerName || 'TA';
    const safeActivity = partnerActivity || (isAway ? PRESENCE_AWAY_ACTIVITY : PRESENCE_DEFAULT_ACTIVITY);
    if (fullEl) fullEl.textContent = `此刻，${safeName}${safeActivity}`;
    if (shortEl) {
        shortEl.textContent = isAway
            ? `${safeName}${PRESENCE_AWAY_ACTIVITY}`
            : `${safeName}${safeActivity}`;
    }
    ui.classList.toggle('is-away', Boolean(isAway));
}

function clearPresenceTimers() {
    if (presenceTrackTimer !== null) {
        clearTimeout(presenceTrackTimer);
        presenceTrackTimer = null;
    }
    if (blurAwayTimer !== null) {
        clearTimeout(blurAwayTimer);
        blurAwayTimer = null;
    }
    if (idleAwayTimer !== null) {
        clearTimeout(idleAwayTimer);
        idleAwayTimer = null;
    }
    if (localAwayExpireTimer !== null) {
        clearTimeout(localAwayExpireTimer);
        localAwayExpireTimer = null;
    }
    if (partnerAwayExpireTimer !== null) {
        clearTimeout(partnerAwayExpireTimer);
        partnerAwayExpireTimer = null;
    }
}

function resetPresenceUI() {
    bothOnline = false;
    clearPresenceTimers();
    partnerAwayObservedAt.clear();
    const ui = document.getElementById('resonance-ui');
    ui?.classList.remove('show', 'is-away');
    updateResonanceBannerText('TA', PRESENCE_DEFAULT_ACTIVITY, false);
    syncHomeSakuraAppearance();
}

function getIdleTimeoutForCurrentRoute() {
    return currentRouteId === 'home' ? PRESENCE_HOME_IDLE_MS : PRESENCE_SUBPAGE_IDLE_MS;
}

function scheduleIdleAwayCheck() {
    if (idleAwayTimer !== null) {
        clearTimeout(idleAwayTimer);
        idleAwayTimer = null;
    }
    if (document.hidden || localPresenceStatus === 'away') return;
    const timeoutMs = getIdleTimeoutForCurrentRoute();
    idleAwayTimer = setTimeout(() => {
        idleAwayTimer = null;
        if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
        enterLocalAwayState('idle');
    }, timeoutMs);
}

function scheduleLocalAwayExpire() {
    if (localAwayExpireTimer !== null) {
        clearTimeout(localAwayExpireTimer);
        localAwayExpireTimer = null;
    }
    const elapsed = localAwaySince > 0 ? Math.max(0, Date.now() - localAwaySince) : 0;
    const remaining = Math.max(1000, PRESENCE_AWAY_EXPIRE_MS - elapsed);
    localAwayExpireTimer = setTimeout(async () => {
        localAwayExpireTimer = null;
        if (localPresenceStatus !== 'away' || !presenceChannel) return;
        isUntrackedDueToAwayTimeout = true;
        try {
            await presenceChannel.untrack();
        } catch (_err) {}
    }, remaining);
}

function enterLocalAwayState(_reason = 'hidden', { immediate = false } = {}) {
    if (presenceTrackTimer !== null) {
        clearTimeout(presenceTrackTimer);
        presenceTrackTimer = null;
    }
    if (blurAwayTimer !== null) {
        clearTimeout(blurAwayTimer);
        blurAwayTimer = null;
    }
    if (idleAwayTimer !== null) {
        clearTimeout(idleAwayTimer);
        idleAwayTimer = null;
    }

    const wasAlreadyAway = localPresenceStatus === 'away';
    localPresenceStatus = 'away';
    if (!wasAlreadyAway || !localAwaySince) {
        localAwaySince = Date.now();
    }

    scheduleLocalAwayExpire();

    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    if (isUntrackedDueToAwayTimeout) return;
    if (!wasAlreadyAway || immediate) {
        lastPresenceTrackTime = Date.now();
        updatePresence().catch(() => {});
    }
}

function resumeLocalActiveState() {
    if (document.hidden) return;
    if (blurAwayTimer !== null) {
        clearTimeout(blurAwayTimer);
        blurAwayTimer = null;
    }
    if (localAwayExpireTimer !== null) {
        clearTimeout(localAwayExpireTimer);
        localAwayExpireTimer = null;
    }

    const needImmediateSync = localPresenceStatus !== 'active' || isUntrackedDueToAwayTimeout;
    localPresenceStatus = 'active';
    localAwaySince = 0;
    isUntrackedDueToAwayTimeout = false;

    scheduleIdleAwayCheck();

    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    if (needImmediateSync) {
        if (presenceTrackTimer !== null) {
            clearTimeout(presenceTrackTimer);
            presenceTrackTimer = null;
        }
        lastPresenceTrackTime = Date.now();
        updatePresence().catch(() => {});
    }
}

function bindPresenceLifecycleListeners() {
    if (presenceLifecycleBound) return;
    presenceLifecycleBound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            enterLocalAwayState('visibilitychange', { immediate: true });
        } else {
            resumeLocalActiveState();
        }
    });

    window.addEventListener('pagehide', () => {
        enterLocalAwayState('pagehide', { immediate: true });
    });

    window.addEventListener('pageshow', () => {
        if (!document.hidden) {
            resumeLocalActiveState();
        }
    });

    window.addEventListener('blur', () => {
        if (document.hidden) {
            enterLocalAwayState('blur_hidden', { immediate: true });
            return;
        }
        if (blurAwayTimer !== null) clearTimeout(blurAwayTimer);
        blurAwayTimer = setTimeout(() => {
            blurAwayTimer = null;
            const hasFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
            if (document.hidden || !hasFocus) {
                enterLocalAwayState('window_blur');
            }
        }, PRESENCE_BLUR_AWAY_DELAY_MS);
    });

    window.addEventListener('focus', () => {
        if (!document.hidden) {
            resumeLocalActiveState();
        }
    });

    const onUserActivity = () => {
        if (document.hidden) return;
        const now = Date.now();
        if (localPresenceStatus !== 'active' || isUntrackedDueToAwayTimeout) {
            resumeLocalActiveState();
            lastInteractionVerifyTime = now;
            return;
        }
        if (now - lastInteractionVerifyTime < 2000) return;
        lastInteractionVerifyTime = now;
        if (blurAwayTimer !== null) {
            clearTimeout(blurAwayTimer);
            blurAwayTimer = null;
        }
        scheduleIdleAwayCheck();
    };

    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(eventName => {
        window.addEventListener(eventName, onUserActivity, { passive: true, capture: true });
    });
}

window.updatePresenceRouteActivity = function(routeId) {
    currentRouteId = routeId || 'home';
    const nextActivity = PRESENCE_ROUTE_ACTIVITY_MAP[currentRouteId] || PRESENCE_DEFAULT_ACTIVITY;
    const changed = nextActivity !== currentPresenceActivity;
    currentPresenceActivity = nextActivity;

    if (!document.hidden) {
        const wasAway = localPresenceStatus !== 'active' || isUntrackedDueToAwayTimeout;
        localPresenceStatus = 'active';
        localAwaySince = 0;
        isUntrackedDueToAwayTimeout = false;
        if (localAwayExpireTimer !== null) {
            clearTimeout(localAwayExpireTimer);
            localAwayExpireTimer = null;
        }
        scheduleIdleAwayCheck();
        if (wasAway && presenceChannel && currentAuthUser && currentUserProfile?.space_id) {
            lastPresenceTrackTime = Date.now();
            updatePresence().catch(() => {});
            return;
        }
    }

    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    if (document.hidden) return;
    if (!changed && Date.now() - lastPresenceTrackTime < 15000) return;

    const now = Date.now();
    const elapsed = now - lastPresenceTrackTime;
    const throttleWindow = changed ? 300 : 1200;
    if (elapsed >= throttleWindow) {
        if (presenceTrackTimer !== null) {
            clearTimeout(presenceTrackTimer);
            presenceTrackTimer = null;
        }
        lastPresenceTrackTime = now;
        updatePresence().catch(() => {});
    } else if (presenceTrackTimer === null) {
        presenceTrackTimer = setTimeout(() => {
            presenceTrackTimer = null;
            if (document.hidden) return;
            lastPresenceTrackTime = Date.now();
            updatePresence().catch(() => {});
        }, throttleWindow - elapsed);
    }
};

function evaluatePartnerPresence(channel, epoch, targetUserId) {
    if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
    if (partnerAwayExpireTimer !== null) {
        clearTimeout(partnerAwayExpireTimer);
        partnerAwayExpireTimer = null;
    }

    const state = channel.presenceState();
    const knownUserIds = new Set(Object.values(allProfilesCache || {}).map(profile => profile.user_id));
    const rawOnlineUserIds = Object.keys(state).filter(userId => knownUserIds.has(userId));
    const partnerUserId = rawOnlineUserIds.find(uid => uid !== targetUserId);
    const partnerPresences = partnerUserId && Array.isArray(state[partnerUserId]) ? state[partnerUserId] : [];

    const now = Date.now();
    const activeRefKeys = new Set();
    const validPartnerRecords = [];
    let minAwayRemainingMs = Infinity;

    partnerPresences.forEach((entry, idx) => {
        if (!entry || typeof entry !== 'object') return;
        const refKey = String(entry.presence_ref || `${partnerUserId}_${idx}`);
        activeRefKeys.add(refKey);

        const rawActivity = typeof entry.activity === 'string' && entry.activity.trim()
            ? entry.activity.trim()
            : PRESENCE_DEFAULT_ACTIVITY;
        const isAway = entry.status === 'away' || rawActivity === PRESENCE_AWAY_ACTIVITY;
        const updatedAt = Number(entry.updated_at) || Date.parse(entry.online_at) || 0;

        if (isAway) {
            let observedStart = partnerAwayObservedAt.get(refKey);
            if (!observedStart) {
                const reportedAwayAt = Number(entry.away_at) || 0;
                // 若对方设备时钟与本机差距在 10 秒以内，可参考其上报时间；否则以本机首次观测时间为准，避免时钟偏差误判
                if (reportedAwayAt > 0 && Math.abs(now - reportedAwayAt) < 10000) {
                    observedStart = Math.min(now, reportedAwayAt);
                } else {
                    observedStart = now;
                }
                partnerAwayObservedAt.set(refKey, observedStart);
            }
            const awayElapsed = Math.max(0, now - observedStart);
            if (awayElapsed >= PRESENCE_AWAY_EXPIRE_MS) {
                // 暂离已超过 60 秒未归，视为已离开收起
                return;
            }
            const remaining = PRESENCE_AWAY_EXPIRE_MS - awayElapsed;
            if (remaining < minAwayRemainingMs) {
                minAwayRemainingMs = remaining;
            }
            validPartnerRecords.push({
                isAway: true,
                activity: PRESENCE_AWAY_ACTIVITY,
                updatedAt
            });
        } else {
            partnerAwayObservedAt.delete(refKey);
            validPartnerRecords.push({
                isAway: false,
                activity: rawActivity,
                updatedAt
            });
        }
    });

    // 清理已断开连接的 refKey 缓存
    Array.from(partnerAwayObservedAt.keys()).forEach(key => {
        if (!activeRefKeys.has(key)) {
            partnerAwayObservedAt.delete(key);
        }
    });

    const selfHasPresence = rawOnlineUserIds.includes(targetUserId) || !isUntrackedDueToAwayTimeout;
    bothOnline = Boolean(selfHasPresence && partnerUserId && validPartnerRecords.length > 0);

    const ui = document.getElementById('resonance-ui');
    if (bothOnline) {
        // 优先展示活跃（active）的终端状态；同状态下取最新更新的一条
        validPartnerRecords.sort((a, b) => {
            if (a.isAway !== b.isAway) return a.isAway ? 1 : -1;
            return b.updatedAt - a.updatedAt;
        });
        const bestRecord = validPartnerRecords[0];
        const partnerProfile = profileForUserId(partnerUserId) || getPartnerProfile();
        const partnerName = partnerProfile?.nickname || partnerProfile?.username || 'TA';
        updateResonanceBannerText(partnerName, bestRecord.activity, bestRecord.isAway);

        if (bestRecord.isAway && Number.isFinite(minAwayRemainingMs)) {
            partnerAwayExpireTimer = setTimeout(() => {
                partnerAwayExpireTimer = null;
                evaluatePartnerPresence(channel, epoch, targetUserId);
            }, Math.max(250, minAwayRemainingMs + 60));
        }
    } else {
        ui?.classList.remove('is-away');
    }

    ui?.classList.toggle('show', bothOnline);
    syncHomeSakuraAppearance();
}

async function initPresence() {
    if (!currentAuthUser || !currentUserProfile?.space_id) return;

    bindPresenceLifecycleListeners();

    const epoch = authEpoch;
    const targetUserId = currentAuthUser.id;
    const targetSpaceId = currentUserProfile.space_id;
    if (typeof getCurrentAppRoute === 'function') {
        const activeRoute = getCurrentAppRoute();
        if (activeRoute?.id) {
            currentRouteId = activeRoute.id;
            if (PRESENCE_ROUTE_ACTIVITY_MAP[activeRoute.id]) {
                currentPresenceActivity = PRESENCE_ROUTE_ACTIVITY_MAP[activeRoute.id];
            }
        }
    }

    if (document.hidden) {
        localPresenceStatus = 'away';
        if (!localAwaySince) localAwaySince = Date.now();
    } else {
        localPresenceStatus = 'active';
        localAwaySince = 0;
        isUntrackedDueToAwayTimeout = false;
        scheduleIdleAwayCheck();
    }

    if (presenceChannel && presenceSpaceId === targetSpaceId) {
        await updatePresence();
        return;
    }

    await cleanupPresence();
    if (!isCurrentAuthSnapshot(epoch, targetUserId)
        || currentUserProfile?.space_id !== targetSpaceId) return;

    presenceSpaceId = targetSpaceId;
    const channel = supabaseClient.channel(`space:${targetSpaceId}:presence`, {
        config: {
            private: true,
            presence: { key: targetUserId },
            broadcast: { self: false, ack: true }
        }
    });
    presenceChannel = channel;

    channel
        .on('presence', { event: 'sync' }, () => {
            evaluatePartnerPresence(channel, epoch, targetUserId);
        })
        .on('broadcast', { event: 'miss_you' }, message => {
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            const senderId = message?.payload?.sender_id;
            if (!senderId || senderId === targetUserId) return;

            const senderProfile = profileForUserId(senderId);
            if (!senderProfile) return;
            const senderName = senderProfile.nickname || senderProfile.username || 'TA';
            if (typeof createHeartRain === 'function') createHeartRain();
            if (typeof showToast === 'function') {
                if (message?.payload?.kind === 'hug') {
                    showToast(`🫂 ${senderName} 给你发来了一个大大的温暖拥抱！`, 4000);
                } else {
                    showToast(`💓 ${senderName} 正在想你哦！`);
                }
            }
        })
        .on('broadcast', { event: 'hug_you' }, message => {
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            const senderId = message?.payload?.sender_id;
            if (!senderId || senderId === targetUserId) return;

            const senderProfile = profileForUserId(senderId);
            const senderName = senderProfile?.nickname || senderProfile?.username || 'TA';
            if (typeof createHeartRain === 'function') createHeartRain();
            if (typeof showToast === 'function') {
                showToast(`🫂 ${senderName} 给你发来了一个大大的温暖拥抱！`, 4000);
            }
        })
        .subscribe(async status => {
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            if (status === 'SUBSCRIBED') {
                lastPresenceTrackTime = Date.now();
                await updatePresence();
                if (localPresenceStatus === 'away') {
                    scheduleLocalAwayExpire();
                } else {
                    scheduleIdleAwayCheck();
                }
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resetPresenceUI();
        });
}

async function updatePresence() {
    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    if (isUntrackedDueToAwayTimeout) return;
    const isAway = localPresenceStatus === 'away' || document.hidden;
    const now = Date.now();
    await presenceChannel.track({
        online_at: new Date(now).toISOString(),
        updated_at: now,
        status: isAway ? 'away' : 'active',
        away_at: isAway ? (localAwaySince || now) : null,
        activity: isAway ? PRESENCE_AWAY_ACTIVITY : currentPresenceActivity
    });
}

window.sendWarmHugToPartner = async function(contextNote = '') {
    if (!currentAuthUser) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    if (typeof createHeartRain === 'function') createHeartRain();
    const partnerProfile = getPartnerProfile();
    const partnerName = partnerProfile?.nickname || partnerProfile?.username || (currentAuthor === '小蛇' ? '小奚' : '小蛇');

    try {
        if (bothOnline && presenceChannel) {
            await presenceChannel.send({
                type: 'broadcast',
                event: 'hug_you',
                payload: {
                    sender_id: currentAuthUser.id,
                    kind: 'hug',
                    note: String(contextNote || '').slice(0, 120)
                }
            });
            if (typeof showToast === 'function') {
                showToast(`🫂 已跨越屏幕给 ${partnerName} 送去一个温暖大拥抱！`, 3500);
            }
            return;
        }
        const { error } = await supabaseClient.rpc('send_miss_you');
        if (error) throw error;
        if (typeof showToast === 'function') {
            showToast(`🫂 已给 ${partnerName} 留下一份温暖的拥抱提醒 💕`, 3500);
        }
    } catch (err) {
        console.warn('发送拥抱互动失败:', err);
        if (typeof showToast === 'function') {
            showToast(`🫂 已向 ${partnerName} 传递了满满的心意与拥抱 💕`, 3200);
        }
    }
};

async function cleanupPresence() {
    const channel = presenceChannel;
    presenceChannel = null;
    presenceSpaceId = null;
    localPresenceStatus = 'active';
    localAwaySince = 0;
    isUntrackedDueToAwayTimeout = false;
    resetPresenceUI();
    if (!channel) return;

    try {
        await channel.untrack();
    } catch (error) {
        console.warn('Presence untrack 失败:', error);
    }
    try {
        await supabaseClient.removeChannel(channel);
    } catch (error) {
        console.warn('Presence 频道清理失败:', error);
    }
}
