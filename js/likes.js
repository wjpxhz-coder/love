// ==========================================
// 动态点赞
// ==========================================
const pendingMomentLikes = new Set();

async function loadMomentLikes(momentIds) {
    if (!isAuthenticated() || !Array.isArray(momentIds) || !momentIds.length) return;
    const uniqueIds = [...new Set(momentIds)].slice(0, 100);
    const epoch = authEpoch;
    const userId = currentAuthUser.id;

    const { data, error } = await supabaseClient
        .from('moment_likes')
        .select('moment_id, user_id, author')
        .in('moment_id', uniqueIds);

    if (!isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('加载动态点赞失败:', error);
        return;
    }

    const countByMoment = {};
    const namesByMoment = {};
    const likedByCurrentUser = {};
    (data || []).forEach(like => {
        countByMoment[like.moment_id] = (countByMoment[like.moment_id] || 0) + 1;
        if (!namesByMoment[like.moment_id]) namesByMoment[like.moment_id] = [];
        if (like.author) namesByMoment[like.moment_id].push(like.author);
        if (like.user_id === userId) likedByCurrentUser[like.moment_id] = true;
    });

    uniqueIds.forEach(momentId => {
        const button = document.getElementById(`moment-like-btn-${momentId}`);
        const countElement = document.getElementById(`moment-like-count-${momentId}`);
        const namesElement = document.getElementById(`moment-like-likers-${momentId}`);
        const heart = button?.querySelector('.ml-heart');
        const count = countByMoment[momentId] || 0;
        const liked = Boolean(likedByCurrentUser[momentId]);

        button?.classList.toggle('liked', liked);
        button?.setAttribute('aria-pressed', String(liked));
        if (heart) heart.textContent = liked ? '❤️' : '🤍';
        if (countElement) countElement.textContent = count ? String(count) : '喜欢';
        if (namesElement) {
            const names = [...new Set(namesByMoment[momentId] || [])];
            namesElement.textContent = names.length ? `${names.join('、')} 觉得很赞 ❤` : '';
        }
    });
}

async function toggleMomentLike(momentId) {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    if (!momentId || pendingMomentLikes.has(momentId)) return;

    const button = document.getElementById(`moment-like-btn-${momentId}`);
    const currentlyLiked = button?.classList.contains('liked') || false;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    pendingMomentLikes.add(momentId);
    if (button) button.disabled = true;

    try {
        const result = currentlyLiked
            ? await supabaseClient
                .from('moment_likes')
                .delete()
                .eq('moment_id', momentId)
                .eq('user_id', userId)
            : await supabaseClient
                .from('moment_likes')
                .insert([{ moment_id: momentId }]);

        if (result.error) throw result.error;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        if (!currentlyLiked && button && typeof spawnHearts === 'function') {
            const rect = button.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
        await loadMomentLikes([momentId]);
    } catch (error) {
        console.error('更新动态点赞失败:', error);
        if (typeof showToast === 'function') showToast('点赞失败，请稍后重试');
    } finally {
        pendingMomentLikes.delete(momentId);
        if (button) button.disabled = false;
    }
}
