// ==========================================
// Supabase Realtime Presence（仅认证空间成员）
// ==========================================

let presenceChannel = null;
let presenceSpaceId = null;

function profileForUserId(userId) {
    return Object.values(allProfilesCache || {}).find(profile => profile.user_id === userId) || null;
}
function resetPresenceUI() {
    bothOnline = false;
    document.getElementById('resonance-ui')?.classList.remove('show');
    const theme = document.documentElement.getAttribute('data-theme');
    sakuraColor = theme === 'dark' ? '#c8a8d8' : '#f2b8c0';
}

async function initPresence() {
    if (!currentAuthUser || !currentUserProfile?.space_id) return;

    const epoch = authEpoch;
    const targetUserId = currentAuthUser.id;
    const targetSpaceId = currentUserProfile.space_id;
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
            ui?.classList.toggle('show', bothOnline);
            sakuraColor = bothOnline
                ? '#ffd700'
                : (document.documentElement.getAttribute('data-theme') === 'dark' ? '#c8a8d8' : '#f2b8c0');
        })
        .on('broadcast', { event: 'miss_you' }, message => {
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            const senderId = message?.payload?.sender_id;
            if (!senderId || senderId === targetUserId) return;

            const senderProfile = profileForUserId(senderId);
            if (!senderProfile) return;
            if (typeof createHeartRain === 'function') createHeartRain();
            if (typeof showToast === 'function') {
                showToast(`💓 ${senderProfile.nickname || senderProfile.username} 正在想你哦！`);
            }
        })
        .subscribe(async status => {
            if (presenceChannel !== channel || !isCurrentAuthSnapshot(epoch, targetUserId)) return;
            if (status === 'SUBSCRIBED') await channel.track({ online_at: new Date().toISOString() });
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resetPresenceUI();
        });
}

async function updatePresence() {
    if (!presenceChannel || !currentAuthUser || !currentUserProfile?.space_id) return;
    await presenceChannel.track({
        online_at: new Date().toISOString()
    });
}

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
