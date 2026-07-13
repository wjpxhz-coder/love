// ==========================================
// 通知功能
// ==========================================
const NOTIFICATION_ACTIONS = {
    moment: '发布了新动态',
    comment: '发表了评论',
    like: '点赞了评论',
    miss: '给你发来了心电感应',
    recalled: '撤回了该互动'
};
let processedMissIds = new Set();
let missEffectTimer = null;

function resetNotificationState() {
    processedMissIds.clear();
    if (missEffectTimer) {
        clearTimeout(missEffectTimer);
        missEffectTimer = null;
    }
}

function isNotificationRead(notification) {
    return Array.isArray(notification.read_by) && notification.read_by.includes(currentAuthor);
}

function notificationPreview(content) {
    if (typeof content !== 'string') return '';
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) return trimmed.slice(0, 160);
    try {
        const parsed = JSON.parse(trimmed);
        const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
        const mediaHint = Array.isArray(parsed.images) && parsed.images.length ? ' [🖼️图片]' : '';
        return `${text}${mediaHint}`.slice(0, 160);
    } catch (_error) {
        return trimmed.slice(0, 160);
    }
}

function formatNotificationTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

function createNotificationItem(notification) {
    const isRead = isNotificationRead(notification);
    const item = document.createElement('li');
    item.className = `notification-item${isRead ? '' : ' unread'}`;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const headline = document.createElement('div');
    const actor = document.createElement('strong');
    actor.textContent = notification.actor || '成员';
    headline.append(actor, document.createTextNode(` ${NOTIFICATION_ACTIONS[notification.type] || '发来了一条通知'}`));
    item.appendChild(headline);

    const preview = notificationPreview(notification.content);
    if (preview) {
        const previewElement = document.createElement('div');
        previewElement.className = 'notification-preview';
        previewElement.textContent = preview;
        item.appendChild(previewElement);
    }

    const time = document.createElement('div');
    time.className = 'notification-time';
    time.textContent = formatNotificationTime(notification.created_at);
    item.appendChild(time);

    const activate = () => handleNotificationClick(notification.id, notification.type, notification.related_id);
    item.addEventListener('click', activate);
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
        }
    });
    return item;
}

async function markSingleNotificationRead(notificationId) {
    if (!isAuthenticated() || !notificationId) return;
    const { error } = await supabaseClient.rpc('mark_notification_read', {
        p_notification_id: notificationId
    });
    if (error) console.error('标记通知已读失败:', error);
}

function scheduleMissEffects(notifications, epoch, userId) {
    if (!notifications.length) return;
    notifications.forEach(notification => processedMissIds.add(notification.id));
    if (missEffectTimer) clearTimeout(missEffectTimer);

    missEffectTimer = setTimeout(async () => {
        missEffectTimer = null;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        if (typeof createHeartRain === 'function') createHeartRain();
        notifications.forEach(notification => {
            if (typeof showToast === 'function') {
                showToast(`💓 ${notification.actor || 'TA'} 在离线期间发来了心电感应！`);
            }
        });

        await Promise.allSettled(notifications.map(notification => markSingleNotificationRead(notification.id)));
        if (isCurrentAuthSnapshot(epoch, userId)) loadNotifications();
    }, 1500);
}

async function loadNotifications() {
    if (!isAuthenticated()) return;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;

    const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, actor_id, recipient_id, actor, type, content, related_id, read_by, created_at')
        .eq('recipient_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (!isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('加载通知失败:', error);
        return;
    }

    const list = document.getElementById('notification-list');
    const badge = document.getElementById('notification-badge');
    if (!list || !badge) return;

    const notifications = data || [];
    const unreadMisses = notifications.filter(notification => (
        notification.type === 'miss'
        && !isNotificationRead(notification)
        && !processedMissIds.has(notification.id)
    ));
    scheduleMissEffects(unreadMisses, epoch, userId);

    list.replaceChildren();
    if (!notifications.length) {
        const empty = document.createElement('li');
        empty.className = 'notification-empty';
        empty.textContent = '暂无通知';
        list.appendChild(empty);
        badge.classList.remove('show');
        badge.setAttribute('aria-hidden', 'true');
        return;
    }

    const fragment = document.createDocumentFragment();
    notifications.forEach(notification => fragment.appendChild(createNotificationItem(notification)));
    list.appendChild(fragment);

    const hasUnread = notifications.some(notification => !isNotificationRead(notification));
    badge.classList.toggle('show', hasUnread);
    badge.setAttribute('aria-hidden', String(!hasUnread));
}

function toggleNotificationPanel() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (!panel) return;

    const open = !panel.classList.contains('show');
    panel.classList.toggle('show', open);
    panel.setAttribute('aria-hidden', String(!open));
    bell?.setAttribute('aria-expanded', String(open));
    if (open) loadNotifications();
}

async function markAllNotificationsRead() {
    if (!isAuthenticated()) return;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const { error } = await supabaseClient.rpc('mark_all_notifications_read');
    if (error) {
        console.error('全部标为已读失败:', error);
        return;
    }
    if (isCurrentAuthSnapshot(epoch, userId)) loadNotifications();
}

async function handleNotificationClick(notificationId, type, relatedId) {
    if (!isAuthenticated()) return;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const panel = document.getElementById('notification-panel');
    panel?.classList.remove('show');
    panel?.setAttribute('aria-hidden', 'true');
    document.getElementById('notification-bell')?.setAttribute('aria-expanded', 'false');
    await markSingleNotificationRead(notificationId);
    if (!isCurrentAuthSnapshot(epoch, userId)) return;

    if (type === 'miss' || type === 'recalled' || !relatedId) {
        loadNotifications();
        return;
    }

    try {
        let targetMomentId = relatedId;
        let targetCommentId = null;
        if (type === 'comment' || type === 'like') {
            targetCommentId = relatedId;
            const { data, error } = await supabaseClient
                .from('comments')
                .select('moment_id')
                .eq('id', relatedId)
                .maybeSingle();
            if (error) throw error;
            if (!isCurrentAuthSnapshot(epoch, userId)) return;
            if (!data) {
                if (typeof showToast === 'function') showToast('该互动已撤回或已不存在。');
                return;
            }
            targetMomentId = data.moment_id;
        }

        const card = document.getElementById(`card-${targetMomentId}`);
        if (!card) {
            const { data: targetMoment, error: targetError } = await supabaseClient
                .from('moments')
                .select('id')
                .eq('id', targetMomentId)
                .maybeSingle();
            if (targetError) throw targetError;
            if (!isCurrentAuthSnapshot(epoch, userId)) return;
            if (typeof showToast === 'function') {
                showToast(targetMoment
                    ? '该动态不在当前视图中，请清除筛选或继续加载回忆。'
                    : '该互动已撤回或已不存在。');
            }
            return;
        }

        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (targetCommentId) {
            const commentsSection = document.getElementById(`comments-${targetMomentId}`);
            if (commentsSection && getComputedStyle(commentsSection).display === 'none') {
                commentsSection.style.display = 'block';
                commentsSection.setAttribute('aria-hidden', 'false');
                document.getElementById(`comment-toggle-${targetMomentId}`)?.setAttribute('aria-expanded', 'true');
                await loadComments(targetMomentId);
            }
            const comment = document.getElementById(`comment-${targetCommentId}`);
            if (comment) {
                comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
                comment.classList.add('notification-target');
                setTimeout(() => comment.classList.remove('notification-target'), 2000);
            }
        }
    } catch (error) {
        console.error('定位通知目标失败:', error);
    } finally {
        if (isCurrentAuthSnapshot(epoch, userId)) loadNotifications();
    }
}
