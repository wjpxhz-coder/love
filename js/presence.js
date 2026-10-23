// ==========================================
// Supabase Realtime Presence（仅认证空间成员）
// ==========================================

let presenceChannel = null;
let presenceSpaceId = null;
let bothOnline = false;
let currentPresenceActivity = '正在陪你看回忆 ✨';
let lastPresenceTrackTime = 0;
let presenceTrackTimer = null;

const PRESENCE_ROUTE_ACTIVITY_MAP = {
    home: '正在陪你看回忆 ✨',
    moment: '正在记录新动态 ✍️',
    mood: '正在记录心情日历 🌈',
    'mood-day': '正在记录心情日历 🌈',
    topics: '正在翻阅恋爱手账 📖',
    'topic-detail': '正在翻阅恋爱手账 📖',
    milestones: '正在重温大事记 🏆',
    blindbox: '正在抽取回忆盲盒 🎲',
    ai: '正在和感情助手聊天 🤖',
    'ai-chat': '正在和感情助手聊天 🤖',
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
    window.homeSakuraEffect?.setAppearance({
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
        bothOnline
    });
}

function updateResonanceBannerText(partnerName = 'TA', partnerActivity = '正在陪你看回忆 ✨') {
    const ui = document.getElementById('resonance-ui');
    if (!ui) return;
    const fullEl = ui.querySelector('.resonance-text-full');
    const shortEl = ui.querySelector('.resonance-text-short');
    const safeName = partnerName || 'TA';
    const safeActivity = partnerActivity || '正在陪你看回忆 ✨';
    if (fullEl) fullEl.textContent = `此刻，${safeName}${safeActivity}`;
    if (shortEl) shortEl.textContent = `此刻，${safeName}也在 ✨`;
}

function resetPresenceUI() {
    bothOnline = false;
    if (presenceTrackTimer !== null) {
        clearTimeout(presenceTrackTimer);
        presenceTrackTimer = null;
    }
    const ui = document.getElementById('resonance-ui');
    ui?.classList.remove('show');
    updateResonanceBannerText('TA', '正在陪你看回忆 ✨');
    syncHomeSakuraAppearance();
}

window.updatePresenceRouteActivity = function(routeId) {
    const nextActivity = PRESENCE_ROUTE_ACTIVITY_MAP[routeId] || '正在陪你看回忆 ✨';
    const changed = nextActivity !== currentPresenceActivity;
    currentPresenceActivity = nextActivity;
    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    if (!changed && Date.now() - lastPresenceTrackTime < 15000) return;

    const now = Date.now();
    const elapsed = now - lastPresenceTrackTime;
    if (elapsed >= 1200) {
        lastPresenceTrackTime = now;
        updatePresence().catch(() => {});
    } else if (presenceTrackTimer === null) {
        presenceTrackTimer = setTimeout(() => {
            presenceTrackTimer = null;
            lastPresenceTrackTime = Date.now();
            updatePresence().catch(() => {});
        }, 1200 - elapsed);
    }
};

async function initPresence() {
    if (!currentAuthUser || !currentUserProfile?.space_id) return;

    const epoch = authEpoch;
    const targetUserId = currentAuthUser.id;
    const targetSpaceId = currentUserProfile.space_id;
    if (typeof getCurrentAppRoute === 'function') {
        const activeRoute = getCurrentAppRoute();
        if (activeRoute?.id && PRESENCE_ROUTE_ACTIVITY_MAP[activeRoute.id]) {
            currentPresenceActivity = PRESENCE_ROUTE_ACTIVITY_MAP[activeRoute.id];
        }
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
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            const state = channel.presenceState();
            const knownUserIds = new Set(Object.values(allProfilesCache).map(profile => profile.user_id));
            const onlineUserIds = new Set(Object.keys(state).filter(userId => knownUserIds.has(userId)));

            bothOnline = onlineUserIds.size >= 2;
            const ui = document.getElementById('resonance-ui');
            if (bothOnline) {
                const partnerUserId = Array.from(onlineUserIds).find(uid => uid !== targetUserId);
                const partnerProfile = partnerUserId ? profileForUserId(partnerUserId) : getPartnerProfile();
                const partnerName = partnerProfile?.nickname || partnerProfile?.username || 'TA';
                const partnerPresences = partnerUserId && Array.isArray(state[partnerUserId]) ? state[partnerUserId] : [];
                const latestPresence = partnerPresences[partnerPresences.length - 1] || {};
                const partnerActivity = typeof latestPresence.activity === 'string' && latestPresence.activity.trim()
                    ? latestPresence.activity.trim()
                    : '正在陪你看回忆 ✨';
                updateResonanceBannerText(partnerName, partnerActivity);
            }
            ui?.classList.toggle('show', bothOnline);
            syncHomeSakuraAppearance();
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
                await channel.track({
                    online_at: new Date().toISOString(),
                    activity: currentPresenceActivity
                });
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resetPresenceUI();
        });
}

async function updatePresence() {
    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    await presenceChannel.track({
        online_at: new Date().toISOString(),
        activity: currentPresenceActivity
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

