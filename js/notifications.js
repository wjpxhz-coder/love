// ==========================================
// 通知功能逻辑
// ==========================================
async function loadNotifications() {
    if (!currentAuthor) return;
    const { data, error } = await supabaseClient
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false }).limit(50);
    
    if (error) {
        console.error('加载通知失败:', error);
        return;
    }

    const listEl = document.getElementById('notification-list');
    const badgeEl = document.getElementById('notification-badge');
    listEl.innerHTML = '';
    
    // 过滤出除了自己产生的之外的通知
    const validNotifications = data.filter(n => n.actor !== currentAuthor);
    
    let hasUnread = false;
    
    if (validNotifications.length === 0) {
        listEl.innerHTML = '<li class="notification-empty">暂无通知</li>';
        badgeEl.classList.remove('show');
        return;
    }
    
    validNotifications.forEach(n => {
        const isRead = n.read_by && n.read_by.includes(currentAuthor);
        if (!isRead) hasUnread = true;
        
        const li = document.createElement('li');
        li.className = `notification-item ${isRead ? '' : 'unread'}`;
        li.setAttribute('onclick', `handleNotificationClick('${n.id}', '${n.type}', '${n.related_id}')`);
        li.style.cursor = 'pointer';
        
        let actionText = '';
        if (n.type === 'moment') actionText = '发布了新动态';
        else if (n.type === 'comment') actionText = '发表了评论';
        else if (n.type === 'like') actionText = '点赞了评论';
        else if (n.type === 'miss') actionText = '给你发来了心电感应';
        else if (n.type === 'recalled') actionText = '撤回了该互动';
        
        let displayContent = n.content || '';
        if (displayContent.startsWith('{') && displayContent.endsWith('}')) {
            try {
                const parsed = JSON.parse(displayContent);
                displayContent = parsed.text || '';
                if (parsed.images && parsed.images.length > 0) {
                    displayContent += ' [🖼️图片]';
                }
            } catch (e) {}
        }
        
        const contentText = displayContent ? `<div style="color: var(--text-muted); font-size: 0.85em; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${displayContent}</div>` : '';
        
        const d = new Date(n.created_at);
        const timeStr = `${d.getMonth()+1}-${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        
        li.innerHTML = `
            <div><strong>${n.actor}</strong> ${actionText}</div>
            ${contentText}
            <div class="notification-time">${timeStr}</div>
        `;
        listEl.appendChild(li);
    });
    
    if (hasUnread) {
        badgeEl.classList.add('show');
    } else {
        badgeEl.classList.remove('show');
    }
}

function toggleNotificationPanel() {
    if (!currentAuthor) {
        openLoginModal();
        return;
    }
    const panel = document.getElementById('notification-panel');
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) {
        loadNotifications();
    }
}

async function markAllNotificationsRead() {
    if (!currentAuthor) return;
    const { data, error } = await supabaseClient
        .from('notifications')
        .select('id, read_by');
        
    if (error) return;
    
    const unreadItems = data.filter(n => !(n.read_by && n.read_by.includes(currentAuthor)));
    if (unreadItems.length === 0) {
        loadNotifications();
        return;
    }
    
    await Promise.all(unreadItems.map(item => {
        const newReadBy = item.read_by ? [...item.read_by, currentAuthor] : [currentAuthor];
        return supabaseClient.from('notifications').update({ read_by: newReadBy }).eq('id', item.id);
    }));
    
    loadNotifications();
}

async function handleNotificationClick(notificationId, type, relatedId) {
    document.getElementById('notification-panel').classList.remove('show');
    await markSingleNotificationRead(notificationId);
    
    if (type === 'miss' || type === 'recalled') {
        return;
    }
    
    try {
        let targetMomentId = relatedId;
        let targetCommentId = null;
        
        if (type === 'comment' || type === 'like') {
            targetCommentId = relatedId;
            const { data, error } = await supabaseClient.from('comments').select('moment_id').eq('id', relatedId).single();
            if (data) {
                targetMomentId = data.moment_id;
            }
        }
        
        const card = document.getElementById(`card-${targetMomentId}`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            if (targetCommentId) {
                const commentsSection = document.getElementById(`comments-${targetMomentId}`);
                if (commentsSection && commentsSection.style.display === 'none') {
                    commentsSection.style.display = 'block';
                    await loadComments(targetMomentId);
                }
                
                setTimeout(() => {
                    const commentEl = document.getElementById(`comment-${targetCommentId}`);
                    if (commentEl) {
                        commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        commentEl.style.transition = 'background-color 0.5s';
                        commentEl.style.backgroundColor = 'rgba(212, 160, 168, 0.4)';
                        setTimeout(() => { commentEl.style.backgroundColor = ''; }, 2000);
                    }
                }, 200);
            }
        } else {
            alert('该动态不在当前视图中，请先向下滑动加载更多回忆~');
        }
    } catch (e) {
        console.error(e);
    }
}

async function markSingleNotificationRead(notificationId) {
    if (!currentAuthor) return;
    const { data } = await supabaseClient.from('notifications').select('read_by').eq('id', notificationId).single();
    if (data && !(data.read_by && data.read_by.includes(currentAuthor))) {
        const newReadBy = data.read_by ? [...data.read_by, currentAuthor] : [currentAuthor];
        await supabaseClient.from('notifications').update({ read_by: newReadBy }).eq('id', notificationId);
        loadNotifications();
    }
}
// 初始化时尝试加载通知
setTimeout(loadNotifications, 1000);
