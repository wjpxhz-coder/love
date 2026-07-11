// ==========================================
// 大事记与收藏功能逻辑 (js/milestones.js)
// ==========================================
let starredMomentIds = new Set();
let currentMilestoneTab = 'list'; // 'list' 或 'gallery'

async function loadMomentStars() {
    if (!currentAuthor) return;
    try {
        const { data, error } = await supabaseClient
            .from('moment_stars')
            .select('moment_id')
            .eq('author', currentAuthor);
        
        if (error) {
            // 表不存在或报错，降级读取本地缓存
            loadMomentStarsFromLocal();
            return;
        }
        
        starredMomentIds.clear();
        (data || []).forEach(item => starredMomentIds.add(Number(item.moment_id)));
        // 同步到本地做 Fallback 备份
        localStorage.setItem('starred_moments_local_' + currentAuthor, JSON.stringify(Array.from(starredMomentIds)));
    } catch (e) {
        loadMomentStarsFromLocal();
    }
}

function loadMomentStarsFromLocal() {
    starredMomentIds.clear();
    try {
        const cached = localStorage.getItem('starred_moments_local_' + currentAuthor);
        if (cached) {
            const arr = JSON.parse(cached);
            arr.forEach(id => starredMomentIds.add(Number(id)));
        }
    } catch (e) {
        console.error('加载本地收藏失败:', e);
    }
}

async function toggleMomentStar(momentId) {
    if (!currentAuthor) {
        openLoginModal();
        return;
    }
    momentId = Number(momentId);
    const hasStarred = starredMomentIds.has(momentId);
    
    // 立即反馈 UI 状态
    const btn = document.getElementById(`moment-star-btn-${momentId}`);
    if (btn) {
        btn.classList.toggle('starred', !hasStarred);
        btn.innerHTML = !hasStarred ? '⭐ 已收藏' : '☆ 收藏';
    }

    try {
        let error = null;
        if (hasStarred) {
            const { error: err } = await supabaseClient
                .from('moment_stars')
                .delete()
                .eq('moment_id', momentId)
                .eq('author', currentAuthor);
            error = err;
        } else {
            const { error: err } = await supabaseClient
                .from('moment_stars')
                .insert([{ moment_id: momentId, author: currentAuthor }]);
            error = err;
            // 收藏时在按钮中心点爆发粉红爱心雨，仪式感拉满
            if (btn && !hasStarred) {
                const rect = btn.getBoundingClientRect();
                if (typeof spawnHearts === 'function') {
                    spawnHearts(rect.left + rect.width / 2, rect.top);
                }
            }
        }

        if (error) {
            console.warn('Supabase moment_stars 表查询失败，降级使用本地存储:', error);
            toggleLocalStar(momentId, hasStarred);
        } else {
            // 数据库操作成功，同步本地状态
            if (hasStarred) {
                starredMomentIds.delete(momentId);
            } else {
                starredMomentIds.add(momentId);
            }
            localStorage.setItem('starred_moments_local_' + currentAuthor, JSON.stringify(Array.from(starredMomentIds)));
        }
    } catch (e) {
        console.warn('星标操作异常，降级本地存储:', e);
        toggleLocalStar(momentId, hasStarred);
    }
    
    // 如果大事记弹窗当前打开，刷新大事记展示
    const modal = document.getElementById('milestonesModal');
    if (modal && modal.open) {
        renderMilestonesContent();
    }
}

function toggleLocalStar(momentId, hasStarred) {
    if (hasStarred) {
        starredMomentIds.delete(momentId);
    } else {
        starredMomentIds.add(momentId);
    }
    localStorage.setItem('starred_moments_local_' + currentAuthor, JSON.stringify(Array.from(starredMomentIds)));
}

// ── 大事记面板控制与渲染 ──

function openMilestonesModal() {
    if (!currentAuthor) {
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
    
    contentContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted);">正在加载大事记... ✨</div>';
    
    // 同步加载星标状态
    await loadMomentStars();

    try {
        const { data, error } = await supabaseClient
            .from('moments')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        // 筛选：(1) JSON中标记为 is_milestone === true  (2) 用户点击了收藏⭐
        const items = (data || []).filter(item => {
            let isMilestone = false;
            try {
                const parsed = JSON.parse(item.content);
                isMilestone = parsed.is_milestone || false;
            } catch (e) {}
            
            const isStarred = starredMomentIds.has(item.id);
            return isMilestone || isStarred;
        });

        if (items.length === 0) {
            contentContainer.innerHTML = `
                <div style="text-align:center; padding:50px 20px; color:var(--text-muted); font-size:0.92em; line-height: 1.6;">
                    🌱 还没有大事记或收藏哦~<br>
                    快去发布时勾选“重大事件”，<br>
                    或在时间轴里点亮 ⭐ 收藏一些美好回忆吧！
                </div>
            `;
            return;
        }

        if (currentMilestoneTab === 'list') {
            renderTimelineList(items, contentContainer);
        } else {
            renderPolaroidWall(items, contentContainer);
        }
    } catch (e) {
        console.error('加载大事记失败:', e);
        contentContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--primary);">加载大事记失败，请重试 😢</div>';
    }
}

function renderTimelineList(items, container) {
    container.innerHTML = '';
    const timeline = document.createElement('div');
    timeline.className = 'milestone-timeline';
    
    items.forEach(item => {
        let text = '';
        let images = [];
        let isMilestone = false;
        try {
            const parsed = JSON.parse(item.content);
            text = parsed.text || '';
            images = parsed.images || [];
            isMilestone = parsed.is_milestone || false;
        } catch (e) {
            text = item.content || '';
        }
        
        const dateObj = new Date(item.created_at);
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        
        // 计算已过天数
        const diffMs = Date.now() - dateObj.getTime();
        const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        const daysHtml = `<span class="milestone-days">已过 ${diffDays} 天 💖</span>`;

        const itemEl = document.createElement('div');
        itemEl.className = 'milestone-list-item';
        
        const imgHtml = images.length > 0 ? `<div class="milestone-item-img" style="background-image: url('${images[0]}');" onclick="if(typeof openLightbox === 'function') openLightbox(event, '${images[0]}')"></div>` : '';
        
        itemEl.innerHTML = `
            <div class="milestone-dot-line">
                <div class="milestone-dot ${isMilestone ? 'gold' : ''}"></div>
                <div class="milestone-line"></div>
            </div>
            <div class="milestone-item-card">
                <div class="milestone-item-header">
                    <span class="milestone-item-date">${dateStr}</span>
                    ${isMilestone ? '<span class="milestone-badge-top">🏆 大事记</span>' : '<span class="milestone-badge-top star">⭐ 收藏</span>'}
                    ${daysHtml}
                </div>
                <div class="milestone-item-body">
                    <div class="milestone-item-text">${text}</div>
                    ${imgHtml}
                </div>
            </div>
        `;
        timeline.appendChild(itemEl);
    });
    
    container.appendChild(timeline);
}

function renderPolaroidWall(items, container) {
    container.innerHTML = '';
    
    // 筛选出有图片的项目
    const photoItems = [];
    items.forEach(item => {
        try {
            const parsed = JSON.parse(item.content);
            if (parsed.images && parsed.images.length > 0) {
                photoItems.push({
                    id: item.id,
                    text: parsed.text || '',
                    image: parsed.images[0],
                    date: new Date(item.created_at)
                });
            }
        } catch (e) {}
    });

    if (photoItems.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:50px 20px; color:var(--text-muted); font-size:0.92em; line-height: 1.6;">
                📸 目前大事记中还没有包含照片的内容哦~<br>
                请在发布重大事件或收藏动态时，上传一张照片吧！
            </div>
        `;
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
        card.innerHTML = `
            <div class="polaroid-img-wrapper" onclick="if(typeof openLightbox === 'function') openLightbox(event, '${item.image}')">
                <img src="${item.image}" alt="polaroid">
            </div>
            <div class="polaroid-caption">${item.text}</div>
            <div class="polaroid-date">${dateStr}</div>
        `;
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
