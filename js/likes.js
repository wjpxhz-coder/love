// ==========================================
// 动态点赞
// ==========================================
const pendingMomentLikes = new Set();
const momentLikesActorsCache = new Map();
const transientPopTimers = new WeakMap();

function triggerTransientPopClass(element, className = 'is-just-liked', duration = 520) {
    if (!element) return;
    let map = transientPopTimers.get(element);
    if (!map) {
        map = new Map();
        transientPopTimers.set(element, map);
    }
    const prevTimer = map.get(className);
    if (prevTimer) clearTimeout(prevTimer);
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    const timerId = setTimeout(() => {
        element.classList.remove(className);
        map.delete(className);
    }, duration);
    map.set(className, timerId);
}

function clearTransientPopClass(element, className = 'is-just-liked') {
    if (!element) return;
    const map = transientPopTimers.get(element);
    if (map && map.has(className)) {
        clearTimeout(map.get(className));
        map.delete(className);
    }
    element.classList.remove(className);
}

window.triggerTransientPopClass = triggerTransientPopClass;
window.clearTransientPopClass = clearTransientPopClass;

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
        const targetIcon = liked ? '#icon-heart-filled' : '#icon-heart';
        const useEl = heart.querySelector('use');
        if (useEl) {
            if (useEl.getAttribute('href') !== targetIcon) {
                useEl.setAttribute('href', targetIcon);
            }
        } else {
            heart.innerHTML = `<svg class="svg-icon" aria-hidden="true"><use href="${targetIcon}"/></svg>`;
        }
    }
    const targetCountEl = countElement || button.querySelector('.ml-count');
    if (targetCountEl) {
        targetCountEl.textContent = liked ? '已喜欢' : '喜欢';
    }
}

function renderMomentLikersElement(element, actors) {
    if (!element) return;
    if (!actors.length) {
        delete element.dataset.actorsSig;
        element.replaceChildren();
        return;
    }
    const nextSig = actors.map(a => `${a.key}:${a.avatarUrl || ''}:${a.displayName || ''}`).join('|');
    if (element.dataset.actorsSig === nextSig && element.childElementCount > 0) {
        return;
    }
    element.dataset.actorsSig = nextSig;
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

function syncMomentLikeDomState(momentId, liked, actors) {
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
}

function buildOptimisticActors(prevActors, userId, authorName, nextLiked) {
    const safePrev = Array.isArray(prevActors) ? prevActors : [];
    const filtered = safePrev.filter(actor => {
        if (!actor) return false;
        if (userId && actor.userId === userId) return false;
        if (authorName && actor.username === authorName) return false;
        return true;
    });
    if (!nextLiked) return filtered;
    const currentActor = resolveLikeActorMeta({ user_id: userId, author: authorName });
    if (!currentActor) return filtered;
    return [...filtered, currentActor].sort((a, b) => a.sortOrder - b.sortOrder);
}

window.resolveLikeActorMeta = resolveLikeActorMeta;
window.resolveLikeActors = resolveLikeActors;
window.createLikeActorBadgeElement = createLikeActorBadgeElement;
window.buildOptimisticActors = buildOptimisticActors;

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
        const key = String(momentId);
        if (!options?.ignorePending && pendingMomentLikes.has(key)) return;
        const liked = Boolean(likedByCurrentUser[momentId]);
        const actors = resolveLikeActors(likesByMoment[momentId] || []);
        momentLikesActorsCache.set(key, actors);

        // 更新页面上所有展示该动态的卡片（支持时间轴、大事记、筛选等多个容器）
        syncMomentLikeDomState(momentId, liked, actors);
    });
}

async function toggleMomentLike(momentId, triggerElement = null) {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    const lockKey = String(momentId ?? '').trim();
    if (!lockKey || pendingMomentLikes.has(lockKey)) return;

    const currentCard = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const button = currentCard ? currentCard.querySelector('.moment-like-btn') : document.getElementById(`moment-like-btn-${momentId}`);
    const currentlyLiked = button?.classList.contains('liked') || false;
    const nextLiked = !currentlyLiked;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const authorName = typeof currentAuthor === 'string' ? currentAuthor : '';
    pendingMomentLikes.add(lockKey);

    const allButtons = Array.from(document.querySelectorAll(`[id="card-${momentId}"] .moment-like-btn, [id="moment-like-btn-${momentId}"]`));
    allButtons.forEach(btn => btn.setAttribute('aria-busy', 'true'));

    const prevActors = momentLikesActorsCache.get(lockKey) || [];
    const optimisticActors = buildOptimisticActors(prevActors, userId, authorName, nextLiked);
    momentLikesActorsCache.set(lockKey, optimisticActors);

    // 零延迟乐观更新 UI 与粒子弹跳
    syncMomentLikeDomState(momentId, nextLiked, optimisticActors);
    if (nextLiked) {
        allButtons.forEach(btn => triggerTransientPopClass(btn, 'is-just-liked', 520));
        const targetBtn = triggerElement?.closest?.('.moment-like-btn') || triggerElement || button;
        if (targetBtn && typeof spawnHearts === 'function') {
            const rect = targetBtn.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
    } else {
        allButtons.forEach(btn => clearTransientPopClass(btn, 'is-just-liked'));
    }

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

        await loadMomentLikes([momentId], { ignorePending: true });
    } catch (error) {
        console.error('更新动态点赞失败:', error);
        if (isCurrentAuthSnapshot(epoch, userId)) {
            momentLikesActorsCache.set(lockKey, prevActors);
            allButtons.forEach(btn => clearTransientPopClass(btn, 'is-just-liked'));
            syncMomentLikeDomState(momentId, currentlyLiked, prevActors);
            if (typeof window.showToast === 'function') {
                window.showToast('点赞未成功，请稍后重试 🌸');
            }
        }
    } finally {
        pendingMomentLikes.delete(lockKey);
        document.querySelectorAll(`[id="card-${momentId}"] .moment-like-btn, [id="moment-like-btn-${momentId}"]`)
            .forEach(btn => btn.removeAttribute('aria-busy'));
    }
}
