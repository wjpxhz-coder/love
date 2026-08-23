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

function setMilestoneStatus(container, text, color = 'var(--text-muted)', padding = '30px') {
    const status = document.createElement('div');
    status.textContent = text;
    Object.assign(status.style, { textAlign: 'center', padding, color });
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

function setMomentStarButtonState(button, isStarred) {
    if (button) {
        button.classList.toggle('starred', isStarred);
        button.textContent = isStarred ? '⭐ 已收藏' : '☆ 收藏';
    }
}

function setMomentStarButtonPending(button, isPending) {
    if (!button) return;
    button.disabled = isPending;
    if (isPending) {
        button.setAttribute('aria-busy', 'true');
    } else {
        button.removeAttribute('aria-busy');
    }
}

function showMomentStarError() {
    if (typeof showToast === 'function') {
        showToast('收藏操作失败，请稍后重试');
    } else {
        alert('收藏操作失败，请稍后重试。');
    }
}

async function toggleMomentStar(momentId) {
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
    const btn = document.getElementById(`moment-star-btn-${momentId}`);
    if (hasStarred) starredMomentIds.delete(momentId);
    else starredMomentIds.add(momentId);
    setMomentStarButtonState(btn, !hasStarred);
    setMomentStarButtonPending(btn, true);
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

        if (!hasStarred && btn && typeof spawnHearts === 'function') {
            const rect = btn.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
    } catch (error) {
        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)
            || String(currentAuthUser.id || '') !== requestUserId) return;
        if (hasStarred) starredMomentIds.add(momentId);
        else starredMomentIds.delete(momentId);
        setMomentStarButtonState(document.getElementById(`moment-star-btn-${momentId}`), hasStarred);
        console.error('收藏操作失败:', error);
        showMomentStarError();
    } finally {
        if (pendingMomentStarIds.get(momentId) === pendingOperation) {
            pendingMomentStarIds.delete(momentId);
            setMomentStarButtonPending(document.getElementById(`moment-star-btn-${momentId}`), false);
        }
    }
    
    // 如果大事记页面当前打开，刷新大事记展示
    const milestonesActive = typeof isAppRouteActive === 'function'
        ? isAppRouteActive('milestones')
        : document.getElementById('milestonesModal')?.classList.contains('is-active');
    if (didChange && milestonesActive) {
        renderMilestonesContent();
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
        const items = typeof hydrateMomentMediaRecord === 'function'
            ? await Promise.all(selectedItems.map(item => hydrateMomentMediaRecord(item)))
            : selectedItems;
        if (requestId !== milestoneRenderRequestId || !isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;

        if (items.length === 0) {
            setMilestoneStatus(
                contentContainer,
                '🌱 还没有大事记或收藏哦~\n快去发布时勾选“重大事件”，\n或在时间轴里点亮 ⭐ 收藏一些美好回忆吧！',
                'var(--text-muted)',
                '50px 20px'
            );
            const empty = contentContainer.firstElementChild;
            if (empty) Object.assign(empty.style, { fontSize: '0.92em', lineHeight: '1.6', whiteSpace: 'pre-line' });
            return;
        }

        renderMilestonesTimelineList(items, contentContainer);
    } catch (e) {
        console.error('加载大事记失败:', e);
        if (requestId === milestoneRenderRequestId && isMilestoneAuthEpochCurrent(requestAuthEpoch)) {
            setMilestoneStatus(contentContainer, '加载大事记失败，请重试 😢', 'var(--primary)');
        }
    }
}

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
