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
const DEFAULT_MOOD_REMINDER_SETTINGS = Object.freeze({
    enabled: true,
    reminderTime: '21:00',
    lastAcknowledgedDate: null
});
let moodReminderSettings = null;
let moodReminderSettingsUserId = null;
let moodReminderTimer = null;
let moodReminderRequestId = 0;

function resetNotificationState() {
    processedMissIds.clear();
    moodReminderRequestId += 1;
    moodReminderSettings = null;
    moodReminderSettingsUserId = null;
    if (moodReminderTimer) {
        clearTimeout(moodReminderTimer);
        moodReminderTimer = null;
    }
    if (missEffectTimer) {
        clearTimeout(missEffectTimer);
        missEffectTimer = null;
    }
}

function normalizeMoodReminderTime(value) {
    const match = String(value || '').match(/^(\d{2}):(\d{2})/);
    if (!match) return DEFAULT_MOOD_REMINDER_SETTINGS.reminderTime;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return DEFAULT_MOOD_REMINDER_SETTINGS.reminderTime;
    return `${match[1]}:${match[2]}`;
}

function currentShanghaiClock() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: typeof MOOD_TIME_ZONE === 'string' ? MOOD_TIME_ZONE : 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { hour: Number(values.hour), minute: Number(values.minute) };
}

function moodReminderIsDue(settings = moodReminderSettings) {
    if (!settings?.enabled) return false;
    const [targetHour, targetMinute] = normalizeMoodReminderTime(settings.reminderTime).split(':').map(Number);
    const now = currentShanghaiClock();
    return now.hour * 60 + now.minute >= targetHour * 60 + targetMinute;
}

function applyMoodReminderSettingsToForm(settings = moodReminderSettings || DEFAULT_MOOD_REMINDER_SETTINGS) {
    const enabledInput = document.getElementById('mood-reminder-enabled');
    const timeInput = document.getElementById('mood-reminder-time');
    if (enabledInput) enabledInput.checked = Boolean(settings.enabled);
    if (timeInput) {
        timeInput.value = normalizeMoodReminderTime(settings.reminderTime);
        timeInput.disabled = !settings.enabled;
    }
}

async function loadMoodReminderSettings({ syncForm = false } = {}) {
    if (!isAuthenticated()) return null;
    const userId = currentAuthUser.id;
    const epoch = authEpoch;
    const { data, error } = await supabaseClient
        .from('mood_reminder_settings')
        .select('enabled, reminder_time, last_acknowledged_date')
        .eq('user_id', userId)
        .maybeSingle();

    if (!isCurrentAuthSnapshot(epoch, userId)) return null;
    if (error) {
        console.error('加载打卡提醒设置失败:', error);
        moodReminderSettings = { ...DEFAULT_MOOD_REMINDER_SETTINGS };
    } else {
        moodReminderSettings = data ? {
            enabled: Boolean(data.enabled),
            reminderTime: normalizeMoodReminderTime(data.reminder_time),
            lastAcknowledgedDate: data.last_acknowledged_date || null
        } : { ...DEFAULT_MOOD_REMINDER_SETTINGS };
    }
    moodReminderSettingsUserId = userId;
    if (syncForm) applyMoodReminderSettingsToForm();
    scheduleMoodReminderCheck();
    return moodReminderSettings;
}

function handleMoodReminderEnabledChange() {
    const enabledInput = document.getElementById('mood-reminder-enabled');
    const timeInput = document.getElementById('mood-reminder-time');
    if (timeInput) timeInput.disabled = !enabledInput?.checked;
}

async function saveMoodReminderSettings() {
    if (!isAuthenticated()) return;
    const enabledInput = document.getElementById('mood-reminder-enabled');
    const timeInput = document.getElementById('mood-reminder-time');
    const saveButton = document.getElementById('mood-reminder-save');
    const message = document.getElementById('mood-reminder-message');
    const enabled = Boolean(enabledInput?.checked);
    const reminderTime = normalizeMoodReminderTime(timeInput?.value);
    const userId = currentAuthUser.id;
    const epoch = authEpoch;
    if (message) message.textContent = '';
    if (saveButton) saveButton.disabled = true;

    try {
        const { data, error } = await supabaseClient
            .from('mood_reminder_settings')
            .upsert({
                user_id: userId,
                enabled,
                reminder_time: `${reminderTime}:00`,
                last_acknowledged_date: moodReminderSettings?.lastAcknowledgedDate || null
            }, { onConflict: 'user_id' })
            .select('enabled, reminder_time, last_acknowledged_date')
            .single();
        if (error) throw error;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;
        moodReminderSettings = {
            enabled: Boolean(data.enabled),
            reminderTime: normalizeMoodReminderTime(data.reminder_time),
            lastAcknowledgedDate: data.last_acknowledged_date || null
        };
        moodReminderSettingsUserId = userId;
        applyMoodReminderSettingsToForm();
        scheduleMoodReminderCheck();
        if (message) message.textContent = '提醒设置已保存。';
        await loadNotifications();
    } catch (error) {
        console.error('保存打卡提醒设置失败:', error);
        if (message) message.textContent = '保存失败，请确认数据库迁移已执行。';
    } finally {
        if (saveButton) saveButton.disabled = false;
    }
}

function scheduleMoodReminderCheck() {
    if (moodReminderTimer) clearTimeout(moodReminderTimer);
    moodReminderTimer = null;
    if (!isAuthenticated() || !moodReminderSettings?.enabled) return;

    const [targetHour, targetMinute] = normalizeMoodReminderTime(moodReminderSettings.reminderTime).split(':').map(Number);
    const now = currentShanghaiClock();
    const nowMinutes = now.hour * 60 + now.minute;
    const targetMinutes = targetHour * 60 + targetMinute;
    let delayMinutes = targetMinutes - nowMinutes;
    if (delayMinutes <= 0) delayMinutes += 24 * 60;
    const delay = Math.max(1000, delayMinutes * 60 * 1000 + 1500);
    moodReminderTimer = setTimeout(async () => {
        moodReminderTimer = null;
        if (isAuthenticated()) await loadNotifications();
        scheduleMoodReminderCheck();
    }, delay);
}

async function getMoodReminderForToday() {
    if (!isAuthenticated()) return null;
    const userId = currentAuthUser.id;
    const epoch = authEpoch;
    if (!moodReminderSettings || moodReminderSettingsUserId !== userId) {
        await loadMoodReminderSettings();
    }
    if (!isCurrentAuthSnapshot(epoch, userId) || !moodReminderIsDue()) return null;

    const today = typeof getAppDateKey === 'function' ? getAppDateKey() : new Date().toISOString().slice(0, 10);
    const { count, error } = await supabaseClient
        .from('moods')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('date', today);
    if (!isCurrentAuthSnapshot(epoch, userId)) return null;
    if (error) {
        console.error('检查今日打卡状态失败:', error);
        return null;
    }
    if ((count || 0) > 0) return null;
    return {
        id: `mood-reminder-${today}`,
        date: today,
        created_at: `${today}T${normalizeMoodReminderTime(moodReminderSettings.reminderTime)}:00+08:00`,
        isRead: moodReminderSettings.lastAcknowledgedDate === today
    };
}

async function acknowledgeMoodReminder() {
    if (!isAuthenticated()) return;
    const today = typeof getAppDateKey === 'function' ? getAppDateKey() : new Date().toISOString().slice(0, 10);
    if (!moodReminderSettings || moodReminderSettingsUserId !== currentAuthUser.id) {
        await loadMoodReminderSettings();
    }
    if (!moodReminderSettings || moodReminderSettings.lastAcknowledgedDate === today) return;

    const userId = currentAuthUser.id;
    const { data, error } = await supabaseClient
        .from('mood_reminder_settings')
        .upsert({
            user_id: userId,
            enabled: moodReminderSettings.enabled,
            reminder_time: `${normalizeMoodReminderTime(moodReminderSettings.reminderTime)}:00`,
            last_acknowledged_date: today
        }, { onConflict: 'user_id' })
        .select('last_acknowledged_date')
        .single();
    if (error) {
        console.error('标记打卡提醒已读失败:', error);
        return;
    }
    if (currentAuthUser?.id === userId) moodReminderSettings.lastAcknowledgedDate = data.last_acknowledged_date;
}

async function refreshMoodReminderState() {
    if (!isAuthenticated()) return;
    await loadNotifications();
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

function createMoodReminderItem(reminder) {
    const item = document.createElement('li');
    item.className = `notification-item mood-reminder-notification${reminder.isRead ? '' : ' unread'}`;
    item.tabIndex = 0;
    item.setAttribute('role', 'button');

    const headline = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = '🌈 今日心情提醒';
    headline.appendChild(title);
    item.appendChild(headline);

    const preview = document.createElement('div');
    preview.className = 'notification-preview';
    preview.textContent = '今天还没有打卡，记录一下此刻的心情吧。';
    item.appendChild(preview);

    const time = document.createElement('div');
    time.className = 'notification-time';
    time.textContent = `每日 ${normalizeMoodReminderTime(moodReminderSettings?.reminderTime)} 提醒`;
    item.appendChild(time);

    const activate = async () => {
        await acknowledgeMoodReminder();
        const panel = document.getElementById('notification-panel');
        panel?.classList.remove('show');
        panel?.setAttribute('aria-hidden', 'true');
        document.getElementById('notification-bell')?.setAttribute('aria-expanded', 'false');
        document.querySelector('.mood-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof openMoodModal === 'function') openMoodModal();
        loadNotifications();
    };
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
    const requestId = ++moodReminderRequestId;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;

    const [notificationResult, moodReminder] = await Promise.all([
        supabaseClient
            .from('notifications')
            .select('id, actor_id, recipient_id, actor, type, content, related_id, read_by, created_at')
            .eq('recipient_id', userId)
            .order('created_at', { ascending: false })
            .limit(50),
        getMoodReminderForToday()
    ]);

    if (requestId !== moodReminderRequestId || !isCurrentAuthSnapshot(epoch, userId)) return;
    const { data, error } = notificationResult;
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
    if (!notifications.length && !moodReminder) {
        const empty = document.createElement('li');
        empty.className = 'notification-empty';
        empty.textContent = '暂无通知';
        list.appendChild(empty);
        badge.classList.remove('show');
        badge.setAttribute('aria-hidden', 'true');
        return;
    }

    const fragment = document.createDocumentFragment();
    if (moodReminder) fragment.appendChild(createMoodReminderItem(moodReminder));
    notifications.forEach(notification => fragment.appendChild(createNotificationItem(notification)));
    list.appendChild(fragment);

    const hasUnread = Boolean(moodReminder && !moodReminder.isRead)
        || notifications.some(notification => !isNotificationRead(notification));
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
    const [notificationResult] = await Promise.all([
        supabaseClient.rpc('mark_all_notifications_read'),
        acknowledgeMoodReminder()
    ]);
    const { error } = notificationResult;
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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !isAuthenticated()) return;
    loadNotifications();
    scheduleMoodReminderCheck();
});
