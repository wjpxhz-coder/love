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
        const count = countByMoment[momentId] || 0;
        const liked = Boolean(likedByCurrentUser[momentId]);
        const names = [...new Set(namesByMoment[momentId] || [])];
        const likersText = names.length ? `${names.join('、')} 觉得很赞 ❤` : '';

        // 更新页面上所有展示该动态的卡片（支持时间轴、大事记、筛选等多个容器）
        const cards = document.querySelectorAll(`[id="card-${momentId}"]`);
        if (cards.length > 0) {
            cards.forEach(card => {
                const button = card.querySelector('.moment-like-btn');
                const countElement = card.querySelector('.ml-count');
                const namesElement = card.querySelector('.moment-like-likers');
                const heart = button?.querySelector('.ml-heart');

                button?.classList.toggle('liked', liked);
                button?.setAttribute('aria-pressed', String(liked));
                if (heart) heart.textContent = liked ? '❤️' : '🤍';
                if (countElement) countElement.textContent = count ? String(count) : '喜欢';
                if (namesElement) namesElement.textContent = likersText;
            });
        } else {
            const buttons = document.querySelectorAll(`[id="moment-like-btn-${momentId}"]`);
            const countElements = document.querySelectorAll(`[id="moment-like-count-${momentId}"]`);
            const namesElements = document.querySelectorAll(`[id="moment-like-likers-${momentId}"]`);
            buttons.forEach(button => {
                const heart = button.querySelector('.ml-heart');
                button.classList.toggle('liked', liked);
                button.setAttribute('aria-pressed', String(liked));
                if (heart) heart.textContent = liked ? '❤️' : '🤍';
            });
            countElements.forEach(el => { el.textContent = count ? String(count) : '喜欢'; });
            namesElements.forEach(el => { el.textContent = likersText; });
        }
    });
}

async function toggleMomentLike(momentId, triggerElement = null) {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    if (!momentId || pendingMomentLikes.has(momentId)) return;

    const currentCard = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const button = currentCard ? currentCard.querySelector('.moment-like-btn') : document.getElementById(`moment-like-btn-${momentId}`);
    const currentlyLiked = button?.classList.contains('liked') || false;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    pendingMomentLikes.add(momentId);

    const allButtons = document.querySelectorAll(`[id="card-${momentId}"] .moment-like-btn, [id="moment-like-btn-${momentId}"]`);
    allButtons.forEach(btn => { btn.disabled = true; });

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

        const targetBtn = triggerElement || button;
        if (!currentlyLiked && targetBtn && typeof spawnHearts === 'function') {
            const rect = targetBtn.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
        await loadMomentLikes([momentId]);
    } catch (error) {
        console.error('更新动态点赞失败:', error);
        if (typeof showToast === 'function') showToast('点赞失败，请稍后重试');
    } finally {
        pendingMomentLikes.delete(momentId);
        allButtons.forEach(btn => { btn.disabled = false; });
    }
}
