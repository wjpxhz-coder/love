// ==========================================
// 大事记与收藏功能逻辑 (js/milestones.js)
// ==========================================
let starredMomentIds = new Set();
let currentMilestoneTab = 'list'; // 'list' 或 'gallery'
let milestoneRenderRequestId = 0;

function hasMilestoneAuthContext() {
    return typeof currentAuthUser !== 'undefined' && Boolean(currentAuthUser) && Boolean(currentAuthor);
}

function getMilestoneAuthEpoch() {
    return typeof authEpoch === 'number' ? authEpoch : 0;
}

function isMilestoneAuthEpochCurrent(epoch) {
    return hasMilestoneAuthContext() && getMilestoneAuthEpoch() === epoch;
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

async function loadMomentStars() {
    if (!hasMilestoneAuthContext()) {
        starredMomentIds.clear();
        return;
    }
    const requestAuthEpoch = getMilestoneAuthEpoch();
    try {
        const { data, error } = await supabaseClient
            .from('moment_stars')
            .select('moment_id')
            .eq('user_id', currentAuthUser.id);

        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;
        if (error) throw error;

        starredMomentIds.clear();
        (data || []).forEach(item => {
            const id = Number(item.moment_id);
            if (Number.isSafeInteger(id) && id > 0) starredMomentIds.add(id);
        });
    } catch (error) {
        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;
        starredMomentIds.clear();
        console.error('加载收藏失败:', error);
        if (typeof showToast === 'function') showToast('收藏加载失败，请稍后重试');
    }
}

function setMomentStarButtonState(button, isStarred) {
    if (button) {
        button.classList.toggle('starred', isStarred);
        button.textContent = isStarred ? '⭐ 已收藏' : '☆ 收藏';
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
    momentId = Number(momentId);
    if (!Number.isSafeInteger(momentId) || momentId <= 0) return;
    const hasStarred = starredMomentIds.has(momentId);
    const btn = document.getElementById(`moment-star-btn-${momentId}`);
    setMomentStarButtonState(btn, !hasStarred);

    try {
        let error = null;
        if (hasStarred) {
            const result = await supabaseClient
                .from('moment_stars')
                .delete()
                .eq('moment_id', momentId)
                .eq('user_id', currentAuthUser.id);
            error = result.error;
        } else {
            const result = await supabaseClient
                .from('moment_stars')
                .insert([{ moment_id: momentId }]);
            error = result.error;
        }

        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;
        if (error) throw error;

        if (hasStarred) starredMomentIds.delete(momentId);
        else starredMomentIds.add(momentId);

        if (!hasStarred && btn && typeof spawnHearts === 'function') {
            const rect = btn.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
    } catch (error) {
        if (!isMilestoneAuthEpochCurrent(requestAuthEpoch)) return;
        setMomentStarButtonState(btn, hasStarred);
        console.error('收藏操作失败:', error);
        showMomentStarError();
    }
    
    // 如果大事记弹窗当前打开，刷新大事记展示
    const modal = document.getElementById('milestonesModal');
    if (modal && modal.open) {
        renderMilestonesContent();
    }
}

// ── 大事记面板控制与渲染 ──

function openMilestonesModal() {
    if (!hasMilestoneAuthContext()) {
        openLoginModal();
        return;
    }
    const modal = document.getElementById('milestonesModal');
    if (!modal) return;
    
    modal.showModal();
    renderMilestonesContent();
}

function closeMilestonesModal() {
    const modal = document.getElementById('milestonesModal');
    if (modal) modal.close();
}

function switchMilestoneTab(tabName) {
    currentMilestoneTab = tabName;
    const tabList = document.getElementById('tab-milestone-list');
    const tabGallery = document.getElementById('tab-milestone-gallery');
    
    if (tabList && tabGallery) {
        tabList.classList.toggle('active', tabName === 'list');
        tabGallery.classList.toggle('active', tabName === 'gallery');
    }
    
    renderMilestonesContent();
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

        if (currentMilestoneTab === 'list') {
            renderTimelineList(items, contentContainer);
        } else {
            renderPolaroidWall(items, contentContainer);
        }
    } catch (e) {
        console.error('加载大事记失败:', e);
        if (requestId === milestoneRenderRequestId && isMilestoneAuthEpochCurrent(requestAuthEpoch)) {
            setMilestoneStatus(contentContainer, '加载大事记失败，请重试 😢', 'var(--primary)');
        }
    }
}

function renderTimelineList(items, container) {
    container.replaceChildren();
    const timeline = document.createElement('div');
    timeline.className = 'milestone-timeline';
    
    items.forEach(item => {
        let text = '';
        let images = [];
        let isMilestone = false;
        try {
            const parsed = JSON.parse(item.content);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                text = typeof parsed.text === 'string' ? parsed.text : '';
                images = Array.isArray(parsed.images) ? parsed.images : [];
                isMilestone = parsed.is_milestone === true;
            }
        } catch (e) {
            text = item.content || '';
        }
        
        const dateObj = new Date(item.created_at);
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        
        // 计算已过天数
        const diffMs = Date.now() - dateObj.getTime();
        const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        const itemEl = document.createElement('div');
        itemEl.className = 'milestone-list-item';

        const dotLine = document.createElement('div');
        dotLine.className = 'milestone-dot-line';
        const dot = document.createElement('div');
        dot.className = `milestone-dot${isMilestone ? ' gold' : ''}`;
        const line = document.createElement('div');
        line.className = 'milestone-line';
        dotLine.append(dot, line);

        const itemCard = document.createElement('div');
        itemCard.className = 'milestone-item-card';
        const header = document.createElement('div');
        header.className = 'milestone-item-header';
        const date = document.createElement('span');
        date.className = 'milestone-item-date';
        date.textContent = dateStr;
        const badge = document.createElement('span');
        badge.className = `milestone-badge-top${isMilestone ? '' : ' star'}`;
        badge.textContent = isMilestone ? '🏆 大事记' : '⭐ 收藏';
        const days = document.createElement('span');
        days.className = 'milestone-days';
        days.textContent = `已过 ${diffDays} 天 💖`;
        header.append(date, badge, days);

        const body = document.createElement('div');
        body.className = 'milestone-item-body';
        const textElement = document.createElement('div');
        textElement.className = 'milestone-item-text';
        textElement.textContent = String(text || '');
        body.appendChild(textElement);
        const imageUrl = images.length > 0 ? getMilestoneTrustedMediaUrl(images[0]) : '';
        if (imageUrl) {
            const image = document.createElement('div');
            image.className = 'milestone-item-img';
            image.style.backgroundImage = `url("${imageUrl}")`;
            image.tabIndex = 0;
            image.setAttribute('role', 'button');
            image.setAttribute('aria-label', '查看大事记图片');
            const showImage = () => {
                if (typeof openLightbox === 'function') openLightbox(imageUrl);
            };
            image.addEventListener('click', showImage);
            image.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    showImage();
                }
            });
            body.appendChild(image);
        }
        itemCard.append(header, body);
        itemEl.append(dotLine, itemCard);
        timeline.appendChild(itemEl);
    });
    
    container.appendChild(timeline);
}

function renderPolaroidWall(items, container) {
    container.replaceChildren();
    
    // 筛选出有图片的项目
    const photoItems = [];
    items.forEach(item => {
        try {
            const parsed = JSON.parse(item.content);
            const imageUrl = parsed && Array.isArray(parsed.images)
                ? getMilestoneTrustedMediaUrl(parsed.images[0])
                : '';
            if (imageUrl) {
                photoItems.push({
                    id: item.id,
                    text: parsed.text || '',
                    image: imageUrl,
                    date: new Date(item.created_at)
                });
            }
        } catch (e) {}
    });

    if (photoItems.length === 0) {
        setMilestoneStatus(
            container,
            '📸 目前大事记中还没有包含照片的内容哦~\n请在发布重大事件或收藏动态时，上传一张照片吧！',
            'var(--text-muted)',
            '50px 20px'
        );
        const empty = container.firstElementChild;
        if (empty) Object.assign(empty.style, { fontSize: '0.92em', lineHeight: '1.6', whiteSpace: 'pre-line' });
        return;
    }

    const wall = document.createElement('div');
    wall.className = 'polaroid-wall';
    
    photoItems.forEach((item, index) => {
        const dateStr = `${item.date.getFullYear()}.${String(item.date.getMonth() + 1).padStart(2, '0')}.${String(item.date.getDate()).padStart(2, '0')}`;
        
        // 旋转倾斜度（-5 到 +5 度，让相纸墙看起来自然生动）
        const angle = (index % 3 === 0 ? -4 : (index % 3 === 1 ? 3 : -2)) + (Math.random() * 2 - 1);
        
        const card = document.createElement('div');
        card.className = 'polaroid-card';
        card.style.transform = `rotate(${angle}deg)`;
        const imageWrapper = document.createElement('div');
        imageWrapper.className = 'polaroid-img-wrapper';
        imageWrapper.tabIndex = 0;
        imageWrapper.setAttribute('role', 'button');
        imageWrapper.setAttribute('aria-label', '查看大事记图片');
        const image = document.createElement('img');
        image.src = item.image;
        image.alt = '大事记照片';
        imageWrapper.appendChild(image);
        const showImage = () => {
            if (typeof openLightbox === 'function') openLightbox(item.image);
        };
        imageWrapper.addEventListener('click', showImage);
        imageWrapper.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                showImage();
            }
        });
        const caption = document.createElement('div');
        caption.className = 'polaroid-caption';
        caption.textContent = String(item.text || '');
        const date = document.createElement('div');
        date.className = 'polaroid-date';
        date.textContent = dateStr;
        card.append(imageWrapper, caption, date);
        wall.appendChild(card);
    });
    
    container.appendChild(wall);
}

function openAddMilestoneDirect() {
    closeMilestonesModal();
    if (typeof openMomentModal === 'function') {
        openMomentModal();
        const chk = document.getElementById('momentIsMilestone');
        if (chk) chk.checked = true;
    }
}
