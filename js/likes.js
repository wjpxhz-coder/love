// ==========================================
// 动态点赞
// ==========================================
const pendingMomentLikes = new Set();

function resolveLikeActorMeta(like) {
    if (!like || typeof like !== 'object') return null;
    const profiles = (typeof allProfilesCache === 'object' && allProfilesCache) ? allProfilesCache : {};
    const author = typeof like.author === 'string' ? like.author.trim() : '';
    const userId = like.user_id ? String(like.user_id).trim() : '';

    let profile = (author && profiles[author]) ? profiles[author] : null;
    if (!profile && userId) {
        profile = Object.values(profiles).find(p => p && String(p.user_id) === userId) || null;
    }

    const username = String(profile?.username || author || '').trim();
    const displayName = String(profile?.nickname || username || '成员').trim();
    const key = userId || username || displayName;
    if (!key) return null;

    const isSnake = username === '小蛇';
    const isXi = username === '小奚';
    const themeClass = isSnake ? 'author-snake' : (isXi ? 'author-xi' : '');
    const fallbackEmoji = isSnake ? '🐍' : (isXi ? '🐟' : '💖');
    const rawAvatar = typeof getProfileAvatarUrl === 'function'
        ? getProfileAvatarUrl(profile)
        : (profile?._avatarResolvedUrl || profile?.avatar_url || '');
    const avatarUrl = typeof sanitizeMediaUrl === 'function'
        ? sanitizeMediaUrl(rawAvatar)
        : String(rawAvatar || '');

    return {
        key,
        userId,
        username,
        displayName,
        themeClass,
        fallbackEmoji,
        avatarUrl,
        sortOrder: isSnake ? 0 : (isXi ? 1 : 2)
    };
}

function resolveLikeActors(likeRows) {
    if (!Array.isArray(likeRows) || !likeRows.length) return [];
    const seen = new Map();
    likeRows.forEach(row => {
        const actor = resolveLikeActorMeta(row);
        if (!actor) return;
        const dedupeKey = actor.username || actor.userId || actor.displayName;
        if (!seen.has(dedupeKey)) {
            seen.set(dedupeKey, actor);
        }
    });
    return Array.from(seen.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

function createLikeActorBadgeElement(actor, options = {}) {
    const variant = options.variant === 'moment' ? 'moment' : 'comment';
    const badge = document.createElement('span');
    badge.className = `like-actor-badge like-actor-badge--${variant}${actor.themeClass ? ` ${actor.themeClass}` : ''}`;
    if (actor.displayName) {
        badge.title = actor.displayName;
    }

    const createEmojiNode = () => {
        const emojiEl = document.createElement('span');
        emojiEl.className = 'like-actor-emoji';
        if (variant === 'moment' && actor.displayName) {
            emojiEl.setAttribute('role', 'img');
            emojiEl.setAttribute('aria-label', actor.displayName);
        } else {
            emojiEl.setAttribute('aria-hidden', 'true');
        }
        emojiEl.textContent = actor.fallbackEmoji;
        return emojiEl;
    };

    if (actor.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'like-actor-avatar';
        avatar.src = actor.avatarUrl;
        avatar.alt = variant === 'moment' ? (actor.displayName || '') : '';
        avatar.decoding = 'async';
        avatar.referrerPolicy = 'no-referrer';
        avatar.addEventListener('error', () => {
            avatar.replaceWith(createEmojiNode());
        }, { once: true });
        badge.appendChild(avatar);
    } else {
        badge.appendChild(createEmojiNode());
    }

    return badge;
}

function applyMomentLikeButtonState(button, countElement, liked, actors) {
    if (!button) return;
    button.classList.toggle('liked', liked);
    button.setAttribute('aria-pressed', String(liked));
    const namesText = actors.map(actor => actor.displayName).join('、');
    const actionLabel = liked ? '取消喜欢此动态' : '喜欢此动态';
    button.setAttribute('aria-label', namesText ? `${actionLabel}（${namesText}已赞）` : actionLabel);
    if (namesText) {
        button.title = `${namesText} 觉得很赞`;
    } else {
        button.removeAttribute('title');
    }

    const heart = button.querySelector('.ml-heart');
    if (heart) {
        heart.innerHTML = `<svg class="svg-icon" aria-hidden="true"><use href="${liked ? '#icon-heart-filled' : '#icon-heart'}"/></svg>`;
    }
    const targetCountEl = countElement || button.querySelector('.ml-count');
    if (targetCountEl) {
        targetCountEl.textContent = liked ? '已喜欢' : '喜欢';
    }
}

function renderMomentLikersElement(element, actors) {
    if (!element) return;
    if (!actors.length) {
        element.replaceChildren();
        return;
    }
    const fragment = document.createDocumentFragment();
    actors.forEach(actor => {
        fragment.appendChild(createLikeActorBadgeElement(actor, { variant: 'moment' }));
    });
    const suffix = document.createElement('span');
    suffix.className = 'moment-likers-suffix';
    suffix.textContent = '觉得很赞 ❤';
    fragment.appendChild(suffix);
    element.replaceChildren(fragment);
}

window.resolveLikeActors = resolveLikeActors;
window.createLikeActorBadgeElement = createLikeActorBadgeElement;

async function loadMomentLikes(momentIds, options = {}) {
    if (!isAuthenticated() || !Array.isArray(momentIds) || !momentIds.length) return;
    const uniqueIds = [...new Set(momentIds)].slice(0, 100);
    const epoch = authEpoch;
    const userId = currentAuthUser.id;

    const queryPromise = supabaseClient
        .from('moment_likes')
        .select('moment_id, user_id, author')
        .in('moment_id', uniqueIds);
    const [{ data, error }, domReady] = await Promise.all([
        queryPromise,
        options?.domReadyPromise ? options.domReadyPromise : Promise.resolve(true)
    ]);

    if (!domReady || !isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('加载动态点赞失败:', error);
        return;
    }

    const likesByMoment = {};
    const likedByCurrentUser = {};
    (data || []).forEach(like => {
        if (!likesByMoment[like.moment_id]) likesByMoment[like.moment_id] = [];
        likesByMoment[like.moment_id].push(like);
        if (like.user_id === userId) likedByCurrentUser[like.moment_id] = true;
    });

    uniqueIds.forEach(momentId => {
        const liked = Boolean(likedByCurrentUser[momentId]);
        const actors = resolveLikeActors(likesByMoment[momentId] || []);

        // 更新页面上所有展示该动态的卡片（支持时间轴、大事记、筛选等多个容器）
        const cards = document.querySelectorAll(`[id="card-${momentId}"]`);
        if (cards.length > 0) {
            cards.forEach(card => {
                const button = card.querySelector('.moment-like-btn');
                const countElement = card.querySelector('.ml-count');
                const namesElement = card.querySelector('.moment-like-likers');
                applyMomentLikeButtonState(button, countElement, liked, actors);
                renderMomentLikersElement(namesElement, actors);
            });
        } else {
            const buttons = document.querySelectorAll(`[id="moment-like-btn-${momentId}"]`);
            const countElements = document.querySelectorAll(`[id="moment-like-count-${momentId}"]`);
            const namesElements = document.querySelectorAll(`[id="moment-like-likers-${momentId}"]`);
            buttons.forEach(button => applyMomentLikeButtonState(button, null, liked, actors));
            countElements.forEach(el => { el.textContent = liked ? '已喜欢' : '喜欢'; });
            namesElements.forEach(el => renderMomentLikersElement(el, actors));
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
