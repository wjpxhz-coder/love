// ==========================================
// 动态点赞功能
// ==========================================
async function loadMomentLikes(momentIds) {
    if (!momentIds.length) return;
    try {
        const { data, error } = await supabaseClient.from('moment_likes')
            .select('moment_id, author')
            .in('moment_id', momentIds);
        if (error) return; // 表可能不存在，静默处理
        const countMap = {};
        const likersMap = {};
        const userLikedMap = {};
        (data || []).forEach(l => {
            countMap[l.moment_id] = (countMap[l.moment_id] || 0) + 1;
            if (!likersMap[l.moment_id]) likersMap[l.moment_id] = [];
            likersMap[l.moment_id].push(l.author);
            if (l.author === currentAuthor) userLikedMap[l.moment_id] = true;
        });
        momentIds.forEach(id => {
            const btn = document.getElementById(`moment-like-btn-${id}`);
            const countEl = document.getElementById(`moment-like-count-${id}`);
            const likersEl = document.getElementById(`moment-like-likers-${id}`);
            const heartEl = btn ? btn.querySelector('.ml-heart') : null;
            const count = countMap[id] || 0;
            const liked = userLikedMap[id] || false;
            if (btn) btn.classList.toggle('liked', liked);
            if (heartEl) heartEl.textContent = liked ? '❤️' : '🤍';
            if (countEl) countEl.textContent = count > 0 ? count : '喜欢';
            if (likersEl) {
                const likers = likersMap[id] || [];
                likersEl.textContent = likers.length > 0 ? likers.join('、') + ' 觉得很赞 ❤' : '';
            }
        });
    } catch(e) {}
}

async function toggleMomentLike(momentId) {
    if (!currentAuthor) {
        openLoginModal();
        return;
    }
    const btn = document.getElementById(`moment-like-btn-${momentId}`);
    const isLiked = btn && btn.classList.contains('liked');
    try {
        let res;
        if (isLiked) {
            res = await supabaseClient.from('moment_likes')
                .delete()
                .eq('moment_id', momentId)
                .eq('author', currentAuthor);
        } else {
            res = await supabaseClient.from('moment_likes')
                .insert([{ moment_id: momentId, author: currentAuthor }]);
            // 点赞时播放爱心动画
            if (btn && !isLiked) {
                const rect = btn.getBoundingClientRect();
                spawnHearts(rect.left + rect.width / 2, rect.top);
            }
        }
        if (res.error) {
            alert('点赞失败，请确保在 Supabase 创建了 moment_likes 表！\n错误信息：' + res.error.message);
            return;
        }
        // 刷新当前动态点赞显示
        loadMomentLikes([momentId]);
    } catch(e) {
        console.error('点赞异常:', e);
    }
}
