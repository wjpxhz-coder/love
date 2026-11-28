// ==========================================
// 大事记与收藏功能逻辑 (js/milestones.js)
// ==========================================
let starredMomentIds = new Set();
const pendingMomentStarIds = new Map();
let momentStarsCacheUserId = null;
let momentStarsCacheAuthEpoch = null;
let momentStarsLoaded = false;
let momentStarsLoadPromise = null;
let milestoneRenderRequestId = 0;

function hasMilestoneAuthContext() {
    return typeof hasAuthContext === 'function' ? hasAuthContext() : Boolean(currentAuthUser && currentAuthor);
}

function getMilestoneAuthEpoch() {
    return typeof getAuthEpoch === 'function' ? getAuthEpoch() : (typeof authEpoch === 'number' ? authEpoch : 0);
}

function isMilestoneAuthEpochCurrent(epoch) {
    return typeof isCurrentAuthSnapshot === 'function' && currentAuthUser
        ? isCurrentAuthSnapshot(epoch, currentAuthUser.id)
        : (hasMilestoneAuthContext() && getMilestoneAuthEpoch() === epoch);
}


function getMilestoneTrustedMediaUrl(value) {
    return typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(value) : '';
}

const milestoneStarPopTimers = new WeakMap();

function triggerMilestoneStarPop(button, duration = 520) {
    if (!button) return;
    if (typeof window.triggerTransientPopClass === 'function') {
        window.triggerTransientPopClass(button, 'is-just-starred', duration);
        return;
    }
    const prev = milestoneStarPopTimers.get(button);
    if (prev) clearTimeout(prev);
    button.classList.remove('is-just-starred');
    void button.offsetWidth;
    button.classList.add('is-just-starred');
    const timer = setTimeout(() => {
        button.classList.remove('is-just-starred');
        milestoneStarPopTimers.delete(button);
    }, duration);
    milestoneStarPopTimers.set(button, timer);
}

function clearMilestoneStarPop(button) {
    if (!button) return;
    if (typeof window.clearTransientPopClass === 'function') {
        window.clearTransientPopClass(button, 'is-just-starred');
        return;
    }
    const prev = milestoneStarPopTimers.get(button);
    if (prev) {
        clearTimeout(prev);
        milestoneStarPopTimers.delete(button);
    }
    button.classList.remove('is-just-starred');
}

function setMilestoneStatus(container, text, options = {}) {
    if (!container) return;
    const status = document.createElement('div');
    status.className = options?.isError ? 'empty-state is-error' : 'empty-state';
    status.textContent = text;
    container.replaceChildren(status);
}

function resetMomentStarsCache(userId = null, epoch = null) {
    starredMomentIds.clear();
    pendingMomentStarIds.clear();
    momentStarsCacheUserId = userId;
    momentStarsCacheAuthEpoch = epoch;
    momentStarsLoaded = false;
    momentStarsLoadPromise = null;
}

async function loadMomentStars(options = {}) {
    if (!hasMilestoneAuthContext()) {
        resetMomentStarsCache();
        return;
    }
    const userId = String(currentAuthUser.id || '');
    if (!userId) {
        resetMomentStarsCache();
        return;
    }
    const requestAuthEpoch = getMilestoneAuthEpoch();
    if (momentStarsCacheUserId !== userId || momentStarsCacheAuthEpoch !== requestAuthEpoch) {
        resetMomentStarsCache(userId, requestAuthEpoch);
    }
    if (momentStarsLoaded && options.force !== true) return;
    if (momentStarsLoadPromise) {
        await momentStarsLoadPromise;
        return;
    }

    const loadPromise = (async () => {
        try {
            const { data, error } = await supabaseClient
                .from('moment_stars')
                .select('moment_id')
                .eq('user_id', userId);

            if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)
                || String(currentAuthUser.id || '') !== userId
                || momentStarsCacheUserId !== userId
                || momentStarsCacheAuthEpoch !== requestAuthEpoch) return;
            if (error) throw error;

            const loadedIds = new Set();
            (data || []).forEach(item => {
                const id = Number(item.moment_id);
                if (Number.isSafeInteger(id) && id > 0) loadedIds.add(id);
            });
            starredMomentIds = loadedIds;
            momentStarsLoaded = true;
        } catch (error) {
            if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)
                || String(currentAuthUser.id || '') !== userId
                || momentStarsCacheUserId !== userId
                || momentStarsCacheAuthEpoch !== requestAuthEpoch) return;
            momentStarsLoaded = false;
            console.error('加载收藏失败:', error);
            if (typeof showToast === 'function') showToast('收藏加载失败，请稍后重试');
        }
    })();
    momentStarsLoadPromise = loadPromise;
    try {
        await loadPromise;
    } finally {
        if (momentStarsLoadPromise === loadPromise) momentStarsLoadPromise = null;
    }
}

const EMPTY_MILESTONES_TEXT = '🌱 还没有大事记或收藏哦~\n快去发布时勾选“重大事件”，\n或在时间轴里点亮 ⭐ 收藏一些美好回忆吧！';

function setMomentStarButtonState(button, isStarred) {
    if (!button) return;
    button.classList.toggle('starred', isStarred);
    button.setAttribute('aria-pressed', String(isStarred));
    button.setAttribute('aria-label', isStarred ? '取消收藏' : '收藏此动态');
    let iconSpan = button.querySelector('.star-btn-icon');
    let textSpan = button.querySelector('.star-btn-text');
    if (iconSpan && textSpan) {
        textSpan.textContent = isStarred ? '已收藏' : '收藏';
    } else {
        const icon = '<span class="star-btn-icon"><svg class="svg-icon" aria-hidden="true"><use href="#icon-star"/></svg></span>';
        button.innerHTML = `${icon}<span class="star-btn-text">${isStarred ? '已收藏' : '收藏'}</span>`;
    }
}

function setMomentStarButtonPending(button, isPending) {
    if (!button) return;
    if (isPending) {
        button.setAttribute('aria-busy', 'true');
    } else {
        button.removeAttribute('aria-busy');
    }
}

function showMomentStarError() {
    if (typeof window.showToast === 'function') {
        window.showToast('收藏操作失败，请稍后重试 🌸');
    }
}

function smoothRemoveMilestoneCard(card, container) {
    if (!card) return;
    if (typeof releaseMomentVideosWithin === 'function') {
        releaseMomentVideosWithin(card, true);
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const finalize = () => {
        card.remove();
        if (container && !container.querySelector('.moment-card')) {
            setMilestoneStatus(container, EMPTY_MILESTONES_TEXT);
        }
    };
    if (reduceMotion || card.offsetHeight === 0) {
        finalize();
        return;
    }
    const startHeight = card.getBoundingClientRect().height;
    const computed = window.getComputedStyle(card);
    card.style.contentVisibility = 'visible';
    card.style.contain = 'none';
    card.style.overflow = 'hidden';
    card.style.pointerEvents = 'none';
    card.style.maxHeight = `${startHeight}px`;
    card.style.paddingTop = computed.paddingTop;
    card.style.paddingBottom = computed.paddingBottom;
    card.style.marginBottom = computed.marginBottom;
    void card.offsetHeight;
    card.style.transition = [
        'opacity 220ms ease',
        'transform 280ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
        'max-height 280ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
        'margin-bottom 280ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
        'padding-top 280ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
        'padding-bottom 280ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
        'border-width 280ms ease'
    ].join(', ');
    requestAnimationFrame(() => {
        card.style.opacity = '0';
        card.style.transform = 'translateX(-16px) scale(0.98)';
        card.style.maxHeight = '0px';
        card.style.marginBottom = '0px';
        card.style.paddingTop = '0px';
        card.style.paddingBottom = '0px';
        card.style.borderTopWidth = '0px';
        card.style.borderBottomWidth = '0px';
    });
    setTimeout(finalize, 285);
}

async function toggleMomentStar(momentId, triggerElement = null) {
    if (!hasMilestoneAuthContext()) {
        openLoginModal();
        return;
    }
    const requestAuthEpoch = getMilestoneAuthEpoch();
    const requestUserId = String(currentAuthUser.id || '');
    momentId = Number(momentId);
    if (!Number.isSafeInteger(momentId) || momentId <= 0) return;
    if (pendingMomentStarIds.has(momentId)) return;

    const pendingOperation = Symbol(`moment-star-${momentId}`);
    pendingMomentStarIds.set(momentId, pendingOperation);
    const hasStarred = starredMomentIds.has(momentId);
    const nextStarred = !hasStarred;
    const allBtns = Array.from(document.querySelectorAll(`[id="card-${momentId}"] .moment-star-btn, [id="moment-star-btn-${momentId}"]`));
    if (hasStarred) starredMomentIds.delete(momentId);
    else starredMomentIds.add(momentId);
    allBtns.forEach(btn => {
        setMomentStarButtonState(btn, nextStarred);
        setMomentStarButtonPending(btn, true);
        if (nextStarred) {
            triggerMilestoneStarPop(btn, 520);
        } else {
            clearMilestoneStarPop(btn);
        }
    });

    // 点击收藏瞬间零延迟绽放粒子
    const targetBtn = triggerElement?.closest?.('.moment-star-btn') || triggerElement || allBtns[0];
    if (nextStarred && targetBtn && typeof spawnHearts === 'function') {
        const rect = targetBtn.getBoundingClientRect();
        spawnHearts(rect.left + rect.width / 2, rect.top);
    }

    let didChange = false;

    try {
        let error = null;
        if (hasStarred) {
            const result = await supabaseClient
                .from('moment_stars')
                .delete()
                .eq('moment_id', momentId)
                .eq('user_id', requestUserId);
            error = result.error;
        } else {
            const result = await supabaseClient
                .from('moment_stars')
                .insert([{ moment_id: momentId }]);
            error = result.error;
        }

        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)
            || String(currentAuthUser.id || '') !== requestUserId) {
            if (momentStarsCacheUserId === requestUserId
                && momentStarsCacheAuthEpoch === requestAuthEpoch) {
                momentStarsLoaded = false;
            }
            return;
        }
        if (error) throw error;

        didChange = true;
    } catch (error) {
        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)
            || String(currentAuthUser.id || '') !== requestUserId) return;
        if (hasStarred) starredMomentIds.add(momentId);
        else starredMomentIds.delete(momentId);
        allBtns.forEach(btn => {
            clearMilestoneStarPop(btn);
            setMomentStarButtonState(btn, hasStarred);
        });
        console.error('收藏操作失败:', error);
        showMomentStarError();
    } finally {
        if (pendingMomentStarIds.get(momentId) === pendingOperation) {
            pendingMomentStarIds.delete(momentId);
            allBtns.forEach(btn => setMomentStarButtonPending(btn, false));
        }
    }

    // 如果大事记页面当前打开，原位平滑移除或刷新展示
    const milestonesActive = typeof isAppRouteActive === 'function'
        ? isAppRouteActive('milestones')
        : document.getElementById('milestonesModal')?.classList.contains('is-active');
    if (didChange && milestonesActive) {
        const milestonesContainer = document.getElementById('milestonesContent');
        const milestoneCard = milestonesContainer?.querySelector(`[id="card-${momentId}"]`);
        if (!nextStarred && milestoneCard && !milestoneCard.classList.contains('milestone')) {
            smoothRemoveMilestoneCard(milestoneCard, milestonesContainer);
        } else if (nextStarred && !milestoneCard) {
            renderMilestonesContent();
        }
    }
}

// ── 大事记面板控制与渲染 ──

function openMilestonesModal() {
    if (typeof appNavigate === 'function') {
        appNavigate('/milestones');
        return;
    }
    window.location.hash = '#/milestones';
}

function enterMilestonesPage() {
    if (!hasMilestoneAuthContext()) return;
    renderMilestonesContent();
}

function closeMilestonesModal() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

async function renderMilestonesContent() {
    const contentContainer = document.getElementById('milestonesContent');
    if (!contentContainer) return;
    if (!hasMilestoneAuthContext()) {
        contentContainer.replaceChildren();
        return;
    }
    const requestAuthEpoch = getMilestoneAuthEpoch();
    const requestId = ++milestoneRenderRequestId;
    setMilestoneStatus(contentContainer, '正在加载大事记... ✨');
    
    // 同步加载星标状态
    await loadMomentStars();
    if (requestId !== milestoneRenderRequestId || !isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;

    try {
        const { data, error } = await supabaseClient
            .from('moments')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(500);
            
        if (error) throw error;
        if (requestId !== milestoneRenderRequestId || !isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;

        // 筛选：(1) JSON中标记为 is_milestone === true  (2) 用户点击了收藏⭐
        const selectedItems = (data || []).filter(item => {
            let isMilestone = false;
            try {
                const parsed = JSON.parse(item.content);
                isMilestone = parsed.is_milestone || false;
            } catch (e) {}
            
            const isStarred = starredMomentIds.has(item.id);
            return isMilestone || isStarred;
        });
        const items = typeof batchHydrateMomentMediaRecords === 'function'
            ? await batchHydrateMomentMediaRecords(selectedItems)
            : (typeof hydrateMomentMediaRecord === 'function'
                ? await Promise.all(selectedItems.map(item => hydrateMomentMediaRecord(item)))
                : selectedItems);
        if (requestId !== milestoneRenderRequestId || !isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;

        if (items.length === 0) {
            setMilestoneStatus(contentContainer, EMPTY_MILESTONES_TEXT);
            return;
        }

        renderMilestonesTimelineList(items, contentContainer);
    } catch (e) {
        console.error('加载大事记失败:', e);
        if (requestId === milestoneRenderRequestId && isMilestoneAuthEpochCurrent(requestAuthEpoch)) {
            setMilestoneStatus(contentContainer, '加载大事记失败，请重试 😢', { isError: true });
        }
    }
}

window.EMPTY_MILESTONES_TEXT = EMPTY_MILESTONES_TEXT;
window.setMilestoneStatus = setMilestoneStatus;

function renderMilestonesTimelineList(items, container) {
    if (typeof releaseMomentVideosWithin === 'function') {
        releaseMomentVideosWithin(container, true);
    }
    container.replaceChildren();
    
    const fragment = document.createDocumentFragment();
    items.forEach((item, cardIndex) => {
        if (typeof createMomentCardElement === 'function') {
            const card = createMomentCardElement(item, {
                cardIndex,
                isInitialBatch: true,
                showMilestoneDays: true
            });
            if (card) fragment.appendChild(card);
        }
    });
    
    const newVideos = Array.from(fragment.querySelectorAll('video'));
    container.appendChild(fragment);
    
    if (typeof refreshMomentVideoPlayback === 'function') {
        newVideos.forEach(video => refreshMomentVideoPlayback(video));
    }
    
    if (typeof initScrollReveal === 'function') {
        setTimeout(() => initScrollReveal(), 50);
    }
    
    const momentIds = items.map(item => item.id);
    if (typeof loadCommentCounts === 'function') {
        loadCommentCounts(momentIds);
    }
    if (typeof loadMomentLikes === 'function') {
        loadMomentLikes(momentIds);
    }
}

function openAddMilestoneDirect() {
    if (typeof openMomentModal === 'function') {
        openMomentModal({ milestone: true });
    }
}
