// ==========================================================================
// 双人话题手账（恋爱小本本）业务逻辑 - js/topics.js
// 完美支持：目录手账、独立会话流、多图上传、录音条、置顶共识便签、实时同步与 AI 智囊
// ==========================================================================

const TOPIC_CATEGORIES = Object.freeze({
    reconciliation: { label: '矛盾和解 🌿', name: '矛盾和解', icon: '🌿' },
    study:          { label: '学习备考 📚', name: '学习备考', icon: '📚' },
    trip:           { label: '旅行规划 ✈️', name: '旅行规划', icon: '✈️' },
    promise:        { label: '未来约定 💍', name: '未来约定', icon: '💍' },
    life:           { label: '生活琐事 💬', name: '生活琐事', icon: '💬' },
    general:        { label: '专属话题 ✨', name: '专属话题', icon: '✨' }
});

let homeTopicsList = [];
let catalogTopicsList = [];
let currentTopicDetail = null;
let currentTopicMessages = [];
let activeTopicCategoryFilter = 'all';

// 请求代次与防重入状态锁
let homeTopicsReqId = 0;
let catalogTopicsReqId = 0;
let topicDetailReqId = 0;
let isTopicAIRequesting = false;
const deletingTopicIds = new Set();
const deletingTopicMsgIds = new Set();

// Realtime 订阅通道
let topicRealtimeChannel = null;

// 多媒体暂存状态
const MAX_TOPIC_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_TOPIC_TEXT_LENGTH = 3000;
let topicSelectedPhotos = [];
let topicPhotoPreviewUrls = new Set();
let topicPhotoItemSeq = 0;
let isTopicRecording = false;
let topicMediaRecorder = null;
let topicAudioChunks = [];
let topicAudioBlob = null;
let topicAudioDurationTimer = null;
let topicRecordingSeconds = 0;
let topicRecordingStream = null;

function getTopicCurrentAuthEpoch() {
    return typeof getAuthEpoch === 'function' ? getAuthEpoch() : (typeof authEpoch === 'number' ? authEpoch : 0);
}

/**
 * HTML 转义工具函数，防止 XSS 注入并安全渲染纯文本
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

/**
 * 格式化相对或友好的时间显示
 */
function formatTopicTime(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '';
        const now = new Date();
        const diffMs = now - date;
        const diffMin = Math.floor(diffMs / (60 * 1000));
        const diffHour = Math.floor(diffMs / (60 * 60 * 1000));
        const diffDay = Math.floor(diffMs / (24 * 60 * 60 * 1000));

        if (diffMin < 1) return '刚刚';
        if (diffMin < 60) return `${diffMin}分钟前`;
        if (diffHour < 24 && date.getDate() === now.getDate()) {
            return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        if (diffDay === 1) {
            return `昨天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        }
        return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    } catch (_e) {
        return dateString;
    }
}

/**
 * 获取当前登录用户的专属存储路径前缀（优先复用 config.js 公共函数）
 */
function getTopicStorageDirectory() {
    if (typeof getSpaceStorageDirectory === 'function') {
        return getSpaceStorageDirectory('topics');
    }
    const spaceId = currentUserProfile && String(currentUserProfile.space_id || '');
    const userId = currentAuthUser && String(currentAuthUser.id || '');
    const isSafe = val => /^[A-Za-z0-9_-]+$/.test(val);
    if (!isSafe(spaceId) || !isSafe(userId)) return '';
    return `${spaceId}/${userId}/topics`;
}

/**
 * 确保当前已获取到情侣空间认证资料（支持初始化异步等待）
 */
async function ensureTopicAuthReady(maxWaitMs = 4000) {
    if (currentUserProfile?.space_id && currentAuthUser) return true;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        if (currentUserProfile?.space_id && currentAuthUser) return true;
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    return Boolean(currentUserProfile?.space_id && currentAuthUser);
}

/**
 * 跨浏览器/移动端统一手账弹窗显示
 */
function showTopicModal(modal) {
    if (!modal) return;
    initTopicModalBackdropHandlers();
    try {
        if (typeof modal.showModal === 'function') {
            if (!modal.open) {
                modal.showModal();
            }
        } else {
            modal.setAttribute('open', '');
        }
    } catch (_e) {
        modal.setAttribute('open', '');
    }
    modal.classList.add('is-open');
}

/**
 * 跨浏览器/移动端统一手账弹窗隐藏
 */
function hideTopicModal(modal) {
    if (!modal) return;
    try {
        if (typeof modal.close === 'function') {
            if (modal.open) {
                modal.close();
            }
        } else {
            modal.removeAttribute('open');
        }
    } catch (_e) {
        modal.removeAttribute('open');
    }
    modal.classList.remove('is-open');
}

/**
 * 为手账弹窗绑定点击背景遮罩自动关闭事件
 */
function initTopicModalBackdropHandlers() {
    document.querySelectorAll('dialog.topic-modal-dialog').forEach(modal => {
        if (modal.dataset.backdropBound) return;
        modal.dataset.backdropBound = 'true';
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideTopicModal(modal);
            }
        });
    });
}

// ==========================================================================
// 1. 首页板块逻辑
// ==========================================================================

async function loadHomeTopics() {
    const container = document.getElementById('home-topics-content');
    if (!container || !supabaseClient) return;

    const reqId = ++homeTopicsReqId;

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed || reqId !== homeTopicsReqId) return;
    }

    const reqEpoch = getTopicCurrentAuthEpoch();

    try {
        const { data, error } = await supabaseClient
            .from('topics')
            .select('*')
            .eq('space_id', currentUserProfile.space_id)
            .order('updated_at', { ascending: false })
            .limit(4);

        if (reqId !== homeTopicsReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;

        if (error) {
            console.error('加载首页话题手账失败:', error);
            container.innerHTML = `<div class="empty-state">加载手账失败，请稍后刷新重试 🌸</div>`;
            return;
        }

        homeTopicsList = data || [];
        renderHomeTopics(homeTopicsList);
    } catch (err) {
        if (reqId !== homeTopicsReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;
        console.error('加载首页话题异常:', err);
        container.innerHTML = `<div class="empty-state">加载手账发生异常 🌸</div>`;
    }
}

function renderHomeTopics(topics) {
    const container = document.getElementById('home-topics-content');
    if (!container) return;

    if (!topics || topics.length === 0) {
        container.innerHTML = `
            <div class="home-topics-empty">
                <div class="home-topics-empty-icon">📖</div>
                <div class="home-topics-empty-text">小蛇和小奚还没有开启手账话题呢～<br>不管是吵架和好、备考打气还是旅行商量，都记在这里吧！</div>
                <button class="btn-topics-new" type="button" onclick="openNewTopicModal()">✨ 开启第一个小话题</button>
            </div>
        `;
        return;
    }

    const cardsHtml = topics.map(topic => {
        const catInfo = TOPIC_CATEGORIES[topic.category] || TOPIC_CATEGORIES.general;
        const isResolved = topic.status === 'resolved';
        const statusHtml = isResolved
            ? `<span class="topic-status-badge resolved">✨ 已达成共识</span>`
            : `<span class="topic-status-badge open">💬 讨论中</span>`;
        
        const summaryHtml = isResolved && topic.summary
            ? `<div class="home-topic-card-summary">🤝 我们的约定：${escapeHtml(topic.summary)}</div>`
            : '';

        const safeId = escapeHtml(String(topic.id));

        return `
            <div class="home-topic-card ${isResolved ? 'is-resolved' : ''}" onclick="appNavigate('/topics/${safeId}')" role="button" tabindex="0">
                <div class="home-topic-card-header">
                    <span class="topic-tag category-${escapeHtml(topic.category)}">${catInfo.label}</span>
                    ${statusHtml}
                </div>
                <h3 class="home-topic-card-title">${escapeHtml(topic.title)}</h3>
                ${summaryHtml}
                <div class="home-topic-card-footer">
                    <span class="home-topic-card-author">✍️ ${escapeHtml(topic.author)}</span>
                    <div class="home-topic-footer-right">
                        <span class="home-topic-card-time">${formatTopicTime(topic.updated_at || topic.created_at)}</span>
                        <div class="topic-card-actions" onclick="event.stopPropagation()">
                            <button class="topic-card-action-link" type="button" onclick="openEditTopicModal('${safeId}', event)" title="编辑手账" aria-label="编辑手账">✏️</button>
                            <button class="topic-card-action-link danger" type="button" onclick="deleteTopic('${safeId}', event)" title="删除手账" aria-label="删除手账">🗑️</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="home-topics-grid">${cardsHtml}</div>`;
}

// ==========================================================================
// 2. 全屏手账目录页面逻辑 (#topicsModal)
// ==========================================================================

async function loadTopicsCatalog(category = activeTopicCategoryFilter) {
    activeTopicCategoryFilter = category;
    const listEl = document.getElementById('topics-catalog-list');
    if (!listEl || !supabaseClient) return;

    const reqId = ++catalogTopicsReqId;

    // 更新筛选胶囊高亮
    document.querySelectorAll('.topics-filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.category === category);
    });

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (reqId !== catalogTopicsReqId) return;
        if (!authed) {
            listEl.innerHTML = `<div class="empty-state">请先登录情侣空间后再查看手账目录 🌸</div>`;
            return;
        }
    }

    const reqEpoch = getTopicCurrentAuthEpoch();
    listEl.innerHTML = `<div class="empty-state">正在翻开我们的手账目录… 📖</div>`;

    try {
        let query = supabaseClient
            .from('topics')
            .select('*')
            .eq('space_id', currentUserProfile.space_id)
            .order('updated_at', { ascending: false });

        if (category && category !== 'all') {
            query = query.eq('category', category);
        }

        const { data, error } = await query;
        if (reqId !== catalogTopicsReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;

        if (error) {
            listEl.innerHTML = `<div class="empty-state">加载手账目录失败，请稍后重试</div>`;
            return;
        }

        catalogTopicsList = data || [];
        renderTopicsCatalog(catalogTopicsList);
    } catch (err) {
        if (reqId !== catalogTopicsReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;
        console.error('加载话题手账目录异常:', err);
        listEl.innerHTML = `<div class="empty-state">加载手账目录异常</div>`;
    }
}

function renderTopicsCatalog(topics) {
    const listEl = document.getElementById('topics-catalog-list');
    if (!listEl) return;

    if (!topics || topics.length === 0) {
        listEl.innerHTML = `
            <div class="home-topics-empty">
                <div class="home-topics-empty-icon">🌸</div>
                <div class="home-topics-empty-text">该分类下暂无话题手账～</div>
                <button class="btn-topics-new" type="button" onclick="openNewTopicModal()">✨ 开启新话题</button>
            </div>
        `;
        return;
    }

    listEl.innerHTML = topics.map(topic => {
        const catInfo = TOPIC_CATEGORIES[topic.category] || TOPIC_CATEGORIES.general;
        const isResolved = topic.status === 'resolved';
        const statusHtml = isResolved
            ? `<span class="topic-status-badge resolved">✨ 达成共识</span>`
            : `<span class="topic-status-badge open">💬 正在交流</span>`;
        
        const summaryHtml = isResolved && topic.summary
            ? `<div class="home-topic-card-summary" style="margin-top:6px;">🤝 约定：${escapeHtml(topic.summary)}</div>`
            : '';

        const safeId = escapeHtml(String(topic.id));

        return `
            <div class="topic-list-card ${isResolved ? 'is-resolved' : ''}" onclick="appNavigate('/topics/${safeId}')" role="button" tabindex="0">
                <div class="topic-list-card-top">
                    <span class="topic-tag category-${escapeHtml(topic.category)}">${catInfo.label}</span>
                    ${statusHtml}
                </div>
                <div class="topic-list-card-title">${escapeHtml(topic.title)}</div>
                ${summaryHtml}
                <div class="topic-list-card-bottom">
                    <span>由 ${escapeHtml(topic.author)} 发起</span>
                    <div class="topic-list-bottom-right">
                        <span>${formatTopicTime(topic.updated_at || topic.created_at)}</span>
                        <div class="topic-card-actions" onclick="event.stopPropagation()">
                            <button class="topic-card-action-link" type="button" onclick="openEditTopicModal('${safeId}', event)" title="编辑手账" aria-label="编辑手账">✏️ 编辑</button>
                            <button class="topic-card-action-link danger" type="button" onclick="deleteTopic('${safeId}', event)" title="删除手账" aria-label="删除手账">🗑️ 删除</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function openTopicsCatalog() {
    appNavigate('/topics');
}

function closeTopicsCatalog() {
    appBack('/');
}

// ==========================================================================
// 3. 新建话题弹窗与提交
// ==========================================================================

let selectedNewTopicCategory = 'reconciliation';

function openNewTopicModal() {
    if (!currentAuthUser || !currentUserProfile?.space_id) {
        if (typeof openLoginModal === 'function') openLoginModal('/topics');
        return;
    }
    const modal = document.getElementById('newTopicModal');
    const input = document.getElementById('newTopicTitleInput');
    const msg = document.getElementById('newTopicModalMsg');
    if (!modal) return;

    if (input) input.value = '';
    if (msg) msg.textContent = '';
    selectedNewTopicCategory = 'reconciliation';

    // 选中默认分类
    document.querySelectorAll('.category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.category === selectedNewTopicCategory);
    });

    showTopicModal(modal);
}

function closeNewTopicModal() {
    const modal = document.getElementById('newTopicModal');
    hideTopicModal(modal);
}

function selectTopicCategory(cat) {
    selectedNewTopicCategory = cat;
    document.querySelectorAll('.category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.category === cat);
    });
}

async function submitCreateTopic() {
    const input = document.getElementById('newTopicTitleInput');
    const msg = document.getElementById('newTopicModalMsg');
    const submitBtn = document.getElementById('btn-submit-new-topic');

    if (!input) return;
    if (!currentAuthUser || !currentUserProfile?.space_id) {
        if (msg) msg.textContent = '请先登录后再开启手账～';
        return;
    }
    const title = input.value.trim();
    if (!title) {
        if (msg) msg.textContent = '请为这次聊天起一个题目吧～';
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (msg) msg.textContent = '正在开启新手账... ✨';

    try {
        const { data, error } = await supabaseClient
            .from('topics')
            .insert({
                space_id: currentUserProfile.space_id,
                user_id: currentAuthUser.id,
                author: currentUserProfile.username,
                title: title,
                category: selectedNewTopicCategory,
                status: 'open'
            })
            .select()
            .single();

        if (error) {
            if (msg) msg.textContent = '开启失败：' + (error.message || '未知错误');
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        closeNewTopicModal();
        if (submitBtn) submitBtn.disabled = false;

        // 刷新列表并直接导航进入该话题详情
        loadHomeTopics();
        appNavigate(`/topics/${data.id}`);
    } catch (err) {
        console.error('创建手账话题异常:', err);
        if (msg) msg.textContent = '开启话题发生异常';
        if (submitBtn) submitBtn.disabled = false;
    }
}

// ==========================================================================
// 4. 话题会话详情页面与 Realtime 监听 (#topicDetailModal)
// ==========================================================================

async function loadTopicDetail(topicId) {
    if (!topicId || !supabaseClient) return;

    const reqId = ++topicDetailReqId;

    const titleEl = document.getElementById('topic-detail-title');
    const flowEl = document.getElementById('topic-messages-flow');
    if (titleEl) titleEl.textContent = '手账加载中…';
    if (flowEl) flowEl.innerHTML = '<div class="empty-state">正在展开这一页的对话回忆… 🌸</div>';

    // 确保认证信息就绪
    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (reqId !== topicDetailReqId) return;
        if (!authed) {
            console.warn('loadTopicDetail: 未能获取到情侣空间认证信息');
            if (titleEl) titleEl.textContent = '请先登录';
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">请先登录情侣空间后再查看本手账哦～ 🌸</div>';
            return;
        }
    }

    const reqEpoch = getTopicCurrentAuthEpoch();

    try {
        // 1. 获取话题基本信息
        const { data: topic, error: topicErr } = await supabaseClient
            .from('topics')
            .select('*')
            .eq('id', topicId)
            .eq('space_id', currentUserProfile.space_id)
            .single();

        if (reqId !== topicDetailReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;

        if (topicErr || !topic) {
            console.error('获取话题失败:', topicErr);
            if (titleEl) titleEl.textContent = '话题不存在或已删除';
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">话题不存在或已被删除 🌸</div>';
            return;
        }

        currentTopicDetail = topic;
        window.currentTopicDetail = topic;
        renderTopicDetailShell(topic);

        // 2. 获取该话题的消息记录
        const { data: messages, error: msgErr } = await supabaseClient
            .from('topic_messages')
            .select('*')
            .eq('topic_id', topicId)
            .eq('space_id', currentUserProfile.space_id)
            .order('created_at', { ascending: true });

        if (reqId !== topicDetailReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;

        if (msgErr) {
            console.error('获取消息失败:', msgErr);
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">加载消息流失败，请重试 🌸</div>';
            return;
        }

        currentTopicMessages = messages || [];
        await renderTopicMessages(currentTopicMessages);
        if (reqId !== topicDetailReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;

        // 3. 订阅该话题的 Realtime 动态
        initTopicRealtimeSubscription(topicId);

        // 滚动到底部最新消息
        scrollTopicToBottom();
    } catch (err) {
        if (reqId !== topicDetailReqId || reqEpoch !== getTopicCurrentAuthEpoch()) return;
        console.error('加载话题详情异常:', err);
        if (titleEl) titleEl.textContent = '加载异常';
        if (flowEl) flowEl.innerHTML = '<div class="empty-state">加载手账发生异常，请刷新重试 🌸</div>';
    }
}

function renderTopicDetailShell(topic) {
    const titleEl = document.getElementById('topic-detail-title');
    const catEl = document.getElementById('topic-detail-category-tag');
    const resolveBtn = document.getElementById('btn-topic-resolve-action');
    const summaryBanner = document.getElementById('topic-summary-banner');

    const catInfo = TOPIC_CATEGORIES[topic.category] || TOPIC_CATEGORIES.general;

    if (titleEl) titleEl.textContent = topic.title;
    if (catEl) {
        catEl.className = `topic-tag category-${escapeHtml(topic.category)}`;
        catEl.textContent = catInfo.label;
    }

    // 达成共识按钮（精简移动端文案防止挤压标题）
    if (resolveBtn) {
        if (topic.status === 'resolved') {
            resolveBtn.className = 'btn-resolve-topic is-resolved';
            resolveBtn.innerHTML = '✨ 编辑共识';
        } else {
            resolveBtn.className = 'btn-resolve-topic';
            resolveBtn.innerHTML = '🤝 达成共识';
        }
    }

    // 置顶高光共识便签
    if (summaryBanner) {
        if (topic.status === 'resolved' && topic.summary) {
            summaryBanner.hidden = false;
            summaryBanner.innerHTML = `
                <div class="topic-summary-stamp">AGREED · 和好</div>
                <div class="topic-summary-badge">🤝 我们的解决方案与约定</div>
                <div class="topic-summary-content">${escapeHtml(topic.summary)}</div>
                <div class="topic-summary-meta">
                    <span>达成于 ${formatTopicTime(topic.resolved_at || topic.updated_at)}</span>
                    <button class="topic-summary-edit-btn" type="button" onclick="openResolveTopicModal()">✏️ 补充修改</button>
                </div>
            `;
        } else {
            summaryBanner.hidden = true;
            summaryBanner.innerHTML = '';
        }
    }
}

function getEmptyTopicMessagesHtml() {
    return `
        <div class="empty-state" style="padding: 30px 10px;">
            💌 还没有发言呢～<br>在下方留言、发照片或录下想说的心声，开始我们的探讨吧！
        </div>
    `;
}

async function buildTopicMessageRowHtml(msg) {
    const isSelf = msg.user_id === currentAuthUser?.id || msg.author === currentUserProfile?.username;
    const authorProfile = Object.values(allProfilesCache || {}).find(p => p.username === msg.author) || null;
    const avatarUrl = authorProfile?._avatarResolvedUrl
        || (authorProfile?.avatar_url ? await resolveMediaUrl(authorProfile.avatar_url) : '');
    const avatarHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(msg.author)}">`
        : (msg.author === '小奚' ? '🌸' : '🐍');

    // 文字内容
    let textBubbleHtml = '';
    if (msg.content && msg.content.trim()) {
        textBubbleHtml = `<div class="topic-message-bubble">${escapeHtml(msg.content)}</div>`;
    }

    // 图片内容（使用索引委托灯箱，彻底杜绝单引号逃逸并支持多图滑动）
    let photosHtml = '';
    if (msg.photos && msg.photos.length > 0) {
        const resolvedPhotos = (typeof batchResolveMediaUrls === 'function'
            ? await batchResolveMediaUrls(msg.photos)
            : await Promise.all(msg.photos.map(ref => resolveMediaUrl(ref)))
        ).filter(Boolean);
        msg._resolvedPhotos = resolvedPhotos;
        const safeMsgId = escapeHtml(String(msg.id));
        const photoItems = resolvedPhotos.map((url, idx) => `
            <div class="topic-message-photo-item" data-msg-id="${safeMsgId}" data-photo-idx="${idx}" onclick="openTopicPhotoLightboxByIndex('${safeMsgId}', ${idx})">
                <img src="${escapeHtml(url)}" alt="话题图片" loading="lazy">
            </div>
        `).join('');
        photosHtml = `<div class="topic-message-photos">${photoItems}</div>`;
    }

    // 音频内容
    let audioHtml = '';
    if (msg.audio_url) {
        const resolvedAudio = await resolveMediaUrl(msg.audio_url);
        if (resolvedAudio) {
            audioHtml = `
                <div class="topic-message-audio-wrap">
                    <audio src="${escapeHtml(resolvedAudio)}" controls preload="none"></audio>
                </div>
            `;
        }
    }

    const safeMsgId = escapeHtml(String(msg.id));
    const deleteMsgBtnHtml = isSelf
        ? `<button class="topic-msg-action-btn" type="button" onclick="deleteTopicMessage('${safeMsgId}')" title="撤回这条心声" aria-label="撤回心声">撤回</button>`
        : '';

    return `
        <div class="topic-message-row ${isSelf ? 'is-self' : ''}" data-msg-id="${safeMsgId}">
            <div class="topic-message-avatar">${avatarHtml}</div>
            <div class="topic-message-body">
                <div class="topic-message-author-time">
                    <div class="topic-msg-author-meta">
                        <span class="topic-msg-author">${escapeHtml(msg.author)}</span>
                        <span class="topic-msg-time">${formatTopicTime(msg.created_at)}</span>
                    </div>
                    ${deleteMsgBtnHtml}
                </div>
                ${textBubbleHtml}
                ${photosHtml}
                ${audioHtml}
            </div>
        </div>
    `;
}

async function renderTopicMessages(messages) {
    const flowEl = document.getElementById('topic-messages-flow');
    if (!flowEl) return;

    if (!messages || messages.length === 0) {
        flowEl.innerHTML = getEmptyTopicMessagesHtml();
        return;
    }

    // 批量收集所有媒体路径，一次性预热签名缓存，消除 N+1 签名网络往返
    if (typeof batchResolveMediaUrls === 'function') {
        const mediaRefsToWarm = [];
        Object.values(allProfilesCache || {}).forEach(p => {
            if (p?.avatar_url && !p._avatarResolvedUrl) mediaRefsToWarm.push(p.avatar_url);
        });
        messages.forEach(m => {
            if (Array.isArray(m?.photos)) mediaRefsToWarm.push(...m.photos);
            if (m?.audio_url) mediaRefsToWarm.push(m.audio_url);
        });
        if (mediaRefsToWarm.length > 0) {
            await batchResolveMediaUrls(mediaRefsToWarm);
        }
    }

    const rowsHtml = await Promise.all(messages.map(msg => buildTopicMessageRowHtml(msg)));
    flowEl.innerHTML = rowsHtml.join('');
}

async function appendSingleTopicMessageToFlow(msg) {
    const flowEl = document.getElementById('topic-messages-flow');
    if (!flowEl || !msg) return;

    const msgIdStr = String(msg.id);
    if (flowEl.querySelector(`.topic-message-row[data-msg-id="${CSS.escape(msgIdStr)}"]`)) {
        return;
    }

    const rowHtml = await buildTopicMessageRowHtml(msg);
    if (flowEl.querySelector(`.topic-message-row[data-msg-id="${CSS.escape(msgIdStr)}"]`)) {
        return;
    }

    const emptyEl = flowEl.querySelector('.empty-state');
    if (emptyEl) emptyEl.remove();

    flowEl.insertAdjacentHTML('beforeend', rowHtml);
}

function removeSingleTopicMessageFromFlow(msgId) {
    const flowEl = document.getElementById('topic-messages-flow');
    if (!flowEl) return;

    const msgIdStr = String(msgId);
    const rowEl = flowEl.querySelector(`.topic-message-row[data-msg-id="${CSS.escape(msgIdStr)}"]`);
    if (rowEl) rowEl.remove();

    if (!flowEl.querySelector('.topic-message-row')) {
        flowEl.innerHTML = getEmptyTopicMessagesHtml();
    }
}

function scrollTopicToBottom() {
    const scroller = document.querySelector('#topicDetailModal .app-page-scroll');
    if (scroller) {
        setTimeout(() => {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        }, 100);
    }
}

function openTopicPhotoLightbox(url, gallery = null, initialIndex = 0) {
    if (typeof openLightbox === 'function') {
        if (Array.isArray(gallery) && gallery.length > 0) {
            openLightbox(url, { gallery, initialIndex });
        } else {
            openLightbox(url);
        }
    }
}

function openTopicPhotoLightboxByIndex(msgId, photoIdx = 0) {
    const msg = (currentTopicMessages || []).find(m => String(m.id) === String(msgId));
    let gallery = Array.isArray(msg?._resolvedPhotos) && msg._resolvedPhotos.length > 0
        ? msg._resolvedPhotos
        : [];

    if (gallery.length === 0) {
        const flowEl = document.getElementById('topic-messages-flow');
        const rowEl = flowEl?.querySelector(`.topic-message-row[data-msg-id="${CSS.escape(String(msgId))}"]`);
        if (rowEl) {
            gallery = Array.from(rowEl.querySelectorAll('.topic-message-photo-item img'))
                .map(img => img.getAttribute('src') || img.src)
                .filter(Boolean);
        }
    }

    const idx = Number.isInteger(Number(photoIdx)) ? Number(photoIdx) : 0;
    const targetUrl = gallery[idx] || gallery[0] || '';
    if (!targetUrl) return;
    openTopicPhotoLightbox(targetUrl, gallery, idx);
}

// ---------------- Realtime 订阅 ----------------
function initTopicRealtimeSubscription(topicId) {
    cleanupTopicRealtimeSubscription();
    if (!supabaseClient || !topicId || !currentUserProfile?.space_id) return;

    topicRealtimeChannel = supabaseClient.channel(`topic:${topicId}:messages`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'topic_messages',
                filter: `topic_id=eq.${topicId}`
            },
            async (payload) => {
                if (!payload?.new) return;
                // 如果是新消息且列表中尚未包含，增量追加而不重绘历史消息
                const exists = currentTopicMessages.some(m => String(m.id) === String(payload.new.id));
                if (!exists) {
                    currentTopicMessages.push(payload.new);
                    await appendSingleTopicMessageToFlow(payload.new);
                    scrollTopicToBottom();
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'DELETE',
                schema: 'public',
                table: 'topic_messages',
                filter: `topic_id=eq.${topicId}`
            },
            (payload) => {
                if (!payload?.old?.id) return;
                currentTopicMessages = currentTopicMessages.filter(m => String(m.id) !== String(payload.old.id));
                removeSingleTopicMessageFromFlow(payload.old.id);
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'topics',
                filter: `id=eq.${topicId}`
            },
            (payload) => {
                if (payload?.new) {
                    currentTopicDetail = payload.new;
                    window.currentTopicDetail = payload.new;
                    renderTopicDetailShell(payload.new);
                }
            }
        )
        .on(
            'postgres_changes',
            {
                event: 'DELETE',
                schema: 'public',
                table: 'topics',
                filter: `id=eq.${topicId}`
            },
            (_payload) => {
                if (typeof showToast === 'function') {
                    showToast('当前手账已被删除 🌸');
                }
                closeTopicDetail();
                loadHomeTopics();
                loadTopicsCatalog(activeTopicCategoryFilter);
            }
        )
        .subscribe();
}

function cleanupTopicRealtimeSubscription() {
    if (topicRealtimeChannel) {
        supabaseClient.removeChannel(topicRealtimeChannel);
        topicRealtimeChannel = null;
    }
}

function closeTopicDetail() {
    cleanupTopicRealtimeSubscription();
    resetTopicComposer();
    currentTopicDetail = null;
    window.currentTopicDetail = null;
    currentTopicMessages = [];
    appBack('/topics');
}

// ==========================================================================
// 5. 消息发送逻辑（富文本 + 图片 + 语音）
// ==========================================================================

function handleTopicTextKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendTopicMessage();
    }
}

function openTopicPhotoPicker() {
    const input = document.getElementById('topicPhotoFileInput');
    if (input) input.click();
}

async function handleTopicPhotoSelect(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    if (topicSelectedPhotos.length + files.length > 9) {
        if (typeof showToast === 'function') {
            showToast('最多只能选择 9 张照片哦～ 🌸');
        } else {
            alert('最多只能选择 9 张照片哦～');
        }
        event.target.value = '';
        return;
    }

    const previewContainer = document.getElementById('topicComposerPhotoPreviews');

    for (const file of files) {
        if (!file.type || !file.type.startsWith('image/')) {
            if (typeof showToast === 'function') {
                showToast('仅支持选择图片格式的文件哦 🌸');
            }
            continue;
        }
        if (file.size > MAX_TOPIC_PHOTO_BYTES) {
            if (typeof showToast === 'function') {
                showToast(`图片「${file.name}」超过 20MB 上限，请换一张更小的图片 🌸`);
            } else {
                alert(`图片「${file.name}」超过 20MB 上限`);
            }
            continue;
        }

        const objUrl = URL.createObjectURL(file);
        const itemId = ++topicPhotoItemSeq;
        topicSelectedPhotos.push({ id: itemId, file, previewUrl: objUrl });
        topicPhotoPreviewUrls.add(objUrl);

        if (previewContainer) {
            previewContainer.hidden = false;
            const imgWrap = document.createElement('div');
            imgWrap.className = 'topic-composer-photo-preview-item';
            imgWrap.dataset.previewUrl = objUrl;
            imgWrap.style.cssText = 'position:relative; width:56px; height:56px; border-radius:8px; overflow:hidden; display:inline-block; margin-right:6px;';
            imgWrap.innerHTML = `
                <img src="${escapeHtml(objUrl)}" style="width:100%; height:100%; object-fit:cover;">
                <button type="button" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer;" onclick="removeTopicPhotoPreview(this, '${escapeHtml(objUrl)}')">×</button>
            `;
            previewContainer.appendChild(imgWrap);
        }
    }
    event.target.value = '';
}

function removeTopicPhotoPreview(btn, url) {
    const targetUrl = url || btn?.parentElement?.dataset?.previewUrl || '';
    if (btn && btn.parentElement) {
        btn.parentElement.remove();
    }
    if (targetUrl) {
        topicSelectedPhotos = topicSelectedPhotos.filter(item => {
            const itemUrl = item?.previewUrl || item?._previewUrl || '';
            return itemUrl !== targetUrl;
        });
        URL.revokeObjectURL(targetUrl);
        topicPhotoPreviewUrls.delete(targetUrl);
    }
    const container = document.getElementById('topicComposerPhotoPreviews');
    if (container && container.children.length === 0) {
        container.hidden = true;
    }
}

// ---------------- 语音录音 ----------------
async function toggleTopicRecording() {
    if (isTopicRecording) {
        stopTopicRecording();
    } else {
        await startTopicRecording();
    }
}

async function startTopicRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('当前浏览器环境不支持语音录制');
        return;
    }

    try {
        if (topicAudioDurationTimer) {
            clearInterval(topicAudioDurationTimer);
            topicAudioDurationTimer = null;
        }
        if (topicRecordingStream) {
            topicRecordingStream.getTracks().forEach(track => track.stop());
            topicRecordingStream = null;
        }

        const activeTopicBeforePrompt = currentActiveTopicId;
        topicRecordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!currentActiveTopicId || currentActiveTopicId !== activeTopicBeforePrompt) {
            topicRecordingStream.getTracks().forEach(track => track.stop());
            topicRecordingStream = null;
            return;
        }
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');

        topicMediaRecorder = mimeType
            ? new MediaRecorder(topicRecordingStream, { mimeType })
            : new MediaRecorder(topicRecordingStream);

        topicAudioChunks = [];
        topicMediaRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) topicAudioChunks.push(e.data);
        };

        topicMediaRecorder.onstop = () => {
            const mime = topicMediaRecorder.mimeType || 'audio/webm';
            topicAudioBlob = new Blob(topicAudioChunks, { type: mime });
            showTopicAudioPreview(topicAudioBlob);
        };

        topicMediaRecorder.start(250);
        isTopicRecording = true;
        topicRecordingSeconds = 0;

        const recordBar = document.getElementById('topicAudioRecordingBar');
        const timerText = document.getElementById('topicAudioRecordingTime');
        const btnRecord = document.getElementById('btn-topic-record');
        if (recordBar) recordBar.hidden = false;
        if (btnRecord) btnRecord.classList.add('recording');
        if (timerText) timerText.textContent = '00:00';

        topicAudioDurationTimer = setInterval(() => {
            topicRecordingSeconds += 1;
            if (timerText) {
                const m = Math.floor(topicRecordingSeconds / 60);
                const s = topicRecordingSeconds % 60;
                timerText.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            }
            if (topicRecordingSeconds >= 120) { // 最多 2 分钟
                stopTopicRecording();
            }
        }, 1000);
    } catch (err) {
        console.error('麦克风录音权限被拒绝或失败:', err);
        alert('无法获取麦克风权限');
    }
}

function stopTopicRecording() {
    if (topicAudioDurationTimer) {
        clearInterval(topicAudioDurationTimer);
        topicAudioDurationTimer = null;
    }
    if (topicMediaRecorder && topicMediaRecorder.state !== 'inactive') {
        topicMediaRecorder.stop();
    }
    if (topicRecordingStream) {
        topicRecordingStream.getTracks().forEach(track => track.stop());
        topicRecordingStream = null;
    }
    isTopicRecording = false;

    const recordBar = document.getElementById('topicAudioRecordingBar');
    const btnRecord = document.getElementById('btn-topic-record');
    if (recordBar) recordBar.hidden = true;
    if (btnRecord) btnRecord.classList.remove('recording');
}

function showTopicAudioPreview(blob) {
    const previewWrap = document.getElementById('topicAudioPreviewWrap');
    const audioPlayer = document.getElementById('topicAudioPlayer');
    if (previewWrap && audioPlayer) {
        if (audioPlayer.src && audioPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(audioPlayer.src);
        }
        audioPlayer.src = URL.createObjectURL(blob);
        previewWrap.hidden = false;
    }
}

function deleteTopicAudioPreview() {
    const previewWrap = document.getElementById('topicAudioPreviewWrap');
    const audioPlayer = document.getElementById('topicAudioPlayer');
    if (audioPlayer && audioPlayer.src) {
        if (audioPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(audioPlayer.src);
        }
        audioPlayer.src = '';
    }
    topicAudioBlob = null;
    topicAudioChunks = [];
    if (previewWrap) previewWrap.hidden = true;
}

function resetTopicComposer() {
    stopTopicRecording();
    deleteTopicAudioPreview();

    const input = document.getElementById('topicComposerTextInput');
    if (input) input.value = '';

    topicPhotoPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    topicPhotoPreviewUrls.clear();
    topicSelectedPhotos = [];
    const photoContainer = document.getElementById('topicComposerPhotoPreviews');
    if (photoContainer) {
        photoContainer.innerHTML = '';
        photoContainer.hidden = true;
    }
}

/**
 * 登出时彻底重置手账内存状态、订阅通道与私密 DOM
 */
function resetTopicsStateOnLogout() {
    homeTopicsReqId += 1;
    catalogTopicsReqId += 1;
    topicDetailReqId += 1;
    deletingTopicIds.clear();
    deletingTopicMsgIds.clear();
    isTopicAIRequesting = false;
    isTopicMessageSending = false;

    cleanupTopicRealtimeSubscription();
    resetTopicComposer();

    homeTopicsList = [];
    catalogTopicsList = [];
    currentTopicDetail = null;
    window.currentTopicDetail = null;
    currentTopicMessages = [];

    ['home-topics-content', 'topics-catalog-list', 'topic-messages-flow'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    const summaryBanner = document.getElementById('topic-summary-banner');
    if (summaryBanner) {
        summaryBanner.hidden = true;
        summaryBanner.innerHTML = '';
    }
}

let isTopicMessageSending = false;

// ---------------- 执行发送 ----------------
async function sendTopicMessage() {
    if (isTopicMessageSending) return;

    const textInput = document.getElementById('topicComposerTextInput');
    const sendBtn = document.getElementById('btn-topic-send');
    const text = textInput ? textInput.value.trim() : '';

    if (text.length > MAX_TOPIC_TEXT_LENGTH) {
        if (typeof showToast === 'function') {
            showToast(`心声留言最多支持 ${MAX_TOPIC_TEXT_LENGTH} 字，请精简后再发送 🌸`);
        } else {
            alert(`心声留言最多支持 ${MAX_TOPIC_TEXT_LENGTH} 字`);
        }
        return;
    }

    const hasText = Boolean(text);
    const hasPhotos = topicSelectedPhotos.length > 0;
    const hasAudio = Boolean(topicAudioBlob);

    if (!hasText && !hasPhotos && !hasAudio) {
        if (textInput) textInput.focus();
        return;
    }

    if (!currentTopicDetail) {
        console.warn('sendTopicMessage: currentTopicDetail 缺失');
        if (typeof showToast === 'function') {
            showToast('手账详情加载中或不存在，请刷新重试 🌸');
        } else {
            alert('手账详情加载中或不存在，请刷新重试 🌸');
        }
        return;
    }

    if (!currentAuthUser || !currentUserProfile?.space_id) {
        console.warn('sendTopicMessage: 认证信息缺失');
        if (typeof showToast === 'function') {
            showToast('请先登录情侣空间后再发送消息哦 🌸');
        } else {
            alert('请先登录情侣空间后再发送消息哦 🌸');
        }
        return;
    }

    isTopicMessageSending = true;
    if (sendBtn) sendBtn.disabled = true;

    const uploadedPhotoRefs = [];
    let uploadedAudioRef = null;

    try {
        const storageDir = getTopicStorageDirectory();
        if ((hasPhotos || hasAudio) && !storageDir) {
            throw new Error('STORAGE_DIR_UNAVAILABLE');
        }

        // 1. 上传图片
        if (hasPhotos) {
            for (let i = 0; i < topicSelectedPhotos.length; i++) {
                const rawItem = topicSelectedPhotos[i];
                const file = rawItem?.file || rawItem;
                if (!file) continue;

                let uploadBlob = file;
                if (typeof compressImageFile === 'function') {
                    try {
                        uploadBlob = await compressImageFile(file);
                    } catch (_e) {
                        uploadBlob = file;
                    }
                }
                const ext = typeof getSafeFileExtension === 'function'
                    ? getSafeFileExtension(file, 'jpg')
                    : (typeof getMomentFileExtension === 'function' ? getMomentFileExtension(file) : 'jpg');
                const randomName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
                const objectPath = `${storageDir}/${randomName}`;

                const { error: uploadErr } = await supabaseClient.storage
                    .from('photos')
                    .upload(objectPath, uploadBlob, { contentType: uploadBlob.type || 'image/jpeg' });

                if (uploadErr) {
                    console.error('上传图片失败:', uploadErr);
                    throw uploadErr;
                }
                uploadedPhotoRefs.push(createStorageReference(objectPath));
            }
        }

        // 2. 上传音频
        if (hasAudio) {
            const ext = topicAudioBlob.type.includes('mp4') ? 'm4a' : 'webm';
            const randomName = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const objectPath = `${storageDir}/${randomName}`;

            const { error: audioUploadErr } = await supabaseClient.storage
                .from('photos')
                .upload(objectPath, topicAudioBlob, { contentType: topicAudioBlob.type });

            if (audioUploadErr) {
                console.error('上传录音失败:', audioUploadErr);
                throw audioUploadErr;
            }
            uploadedAudioRef = createStorageReference(objectPath);
        }

        // 3. 写入 topic_messages 表
        const { data, error } = await supabaseClient
            .from('topic_messages')
            .insert({
                topic_id: currentTopicDetail.id,
                space_id: currentUserProfile.space_id,
                user_id: currentAuthUser.id,
                author: currentUserProfile.username,
                content: text || null,
                photos: uploadedPhotoRefs,
                audio_url: uploadedAudioRef
            })
            .select()
            .single();

        if (error) {
            console.error('保存消息失败:', error);
            await removeUploadedTopicObjects([...uploadedPhotoRefs, uploadedAudioRef].filter(Boolean));
            if (typeof showToast === 'function') {
                showToast('发送失败：' + error.message);
            } else {
                alert('发送失败：' + error.message);
            }
            return;
        }

        // 清理输入状态
        resetTopicComposer();

        // 本地立即增量追加（Realtime 会有去重）
        if (!currentTopicMessages.some(m => String(m.id) === String(data.id))) {
            currentTopicMessages.push(data);
        }
        await appendSingleTopicMessageToFlow(data);
        scrollTopicToBottom();
    } catch (err) {
        console.error('发送话题消息异常:', err);
        await removeUploadedTopicObjects([...uploadedPhotoRefs, uploadedAudioRef].filter(Boolean));
        if (typeof showToast === 'function') {
            showToast('发送发生异常，请重试');
        } else {
            alert('发送发生异常，请重试');
        }
    } finally {
        isTopicMessageSending = false;
        if (sendBtn) sendBtn.disabled = false;
    }
}

// ==========================================================================
// 6. 达成共识与解决方案撰写
// ==========================================================================

function openResolveTopicModal() {
    const modal = document.getElementById('resolveTopicModal');
    const input = document.getElementById('resolveSummaryInput');
    const msg = document.getElementById('resolveTopicModalMsg');
    if (!modal) return;

    if (input) {
        input.value = currentTopicDetail?.summary || '';
    }
    if (msg) msg.textContent = '';

    showTopicModal(modal);
}

function closeResolveTopicModal() {
    const modal = document.getElementById('resolveTopicModal');
    hideTopicModal(modal);
}

async function submitResolveTopic() {
    if (!currentTopicDetail || !supabaseClient) return;

    const input = document.getElementById('resolveSummaryInput');
    const msg = document.getElementById('resolveTopicModalMsg');
    const submitBtn = document.getElementById('btn-submit-resolve-topic');
    const summary = input ? input.value.trim() : '';

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) {
            if (msg) msg.textContent = '请先登录情侣空间后再记录共识 🌸';
            return;
        }
    }

    if (!summary) {
        if (msg) msg.textContent = '请写下我们达成的约定或解决方案吧～';
        return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (msg) msg.textContent = '正在铭刻我们的共识... ✨';

    try {
        const { data, error } = await supabaseClient
            .from('topics')
            .update({
                status: 'resolved',
                summary: summary,
                resolved_at: new Date().toISOString(),
                resolved_by: currentUserProfile.username
            })
            .eq('id', currentTopicDetail.id)
            .eq('space_id', currentUserProfile.space_id)
            .select()
            .single();

        if (error) {
            console.error('更新共识失败:', error);
            if (msg) msg.textContent = '保存失败：' + error.message;
            return;
        }

        currentTopicDetail = data;
        window.currentTopicDetail = data;
        renderTopicDetailShell(data);
        closeResolveTopicModal();

        // 刷新列表
        loadHomeTopics();
    } catch (err) {
        console.error('保存共识异常:', err);
        if (msg) msg.textContent = '保存共识发生异常';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

// ==========================================================================
// 7. 召唤 Agnes AI 感情助手（温柔智囊）
// ==========================================================================

async function requestAITopicAdvice() {
    if (isTopicAIRequesting || !currentTopicDetail) return;
    const modal = document.getElementById('aiTopicAdviceModal');
    const contentArea = document.getElementById('aiTopicAdviceContent');
    const applyBtn = document.getElementById('btn-ai-apply-summary');
    if (!modal || !contentArea) return;

    if (applyBtn) applyBtn.hidden = true;
    showTopicModal(modal);

    if (typeof hasAIServiceConsent === 'function' && !hasAIServiceConsent()) {
        contentArea.innerHTML = `<div class="empty-state">请先在「头像 → 设置 → 我们的感情助手」中开启服务后再召唤 Agnes 哦 🌸</div>`;
        return;
    }

    isTopicAIRequesting = true;
    contentArea.innerHTML = `<div class="ai-loading">🌸 正在请教感情助手 Agnes，请稍候… ✨</div>`;

    try {
        const catInfo = TOPIC_CATEGORIES[currentTopicDetail.category] || TOPIC_CATEGORIES.general;
        const recentMessages = currentTopicMessages
            .slice(-12)
            .map(m => `${m.author}: ${m.content || (m.photos?.length ? '[图片]' : '') || (m.audio_url ? '[语音]' : '[多媒体]')}`)
            .join('\n');

        const systemPrompt = [
            '你是“我们的感情助手” Agnes，小奚和小蛇专属的温柔恋爱智囊与沟通调解官。',
            typeof AI_COUPLE_IDENTITY_RULES === 'string' ? AI_COUPLE_IDENTITY_RULES : '',
            '请始终保持温暖、客观、充满爱意与同理心的语气，帮助两人互相理解、化解分歧或共同规划未来。'
        ].filter(Boolean).join('\n');

        const prompt = `我们正在情侣小家的话题手账讨论「${currentTopicDetail.title}」（分类：${catInfo.name}）。\n以下是我们近期的沟通记录：\n${recentMessages || '（暂未开始发言，请针对话题题目给出破冰沟通建议）'}\n\n请作为我们温柔体贴的恋爱小助理，从客观、温和、充满爱意的角度给出：\n1. 调解与建议锦囊（如何更好互相理解与解决）；\n2. 一份建议的「达成共识与约定草稿」（50~150字，以情侣双方第一人称视角，充满仪式感）。`;

        let replyText = '';
        if (typeof callAgnes === 'function') {
            replyText = await callAgnes(systemPrompt, prompt);
        } else {
            const response = await supabaseClient.functions.invoke('ai-chat', {
                headers: {
                    'x-agnes-consent-version': typeof AGNES_CONSENT_VERSION === 'string' ? AGNES_CONSENT_VERSION : 'agnes-2.0-v1'
                },
                body: {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: prompt }
                    ]
                }
            });
            if (response.error) throw response.error;
            replyText = response.data?.choices?.[0]?.message?.content?.trim() || response.data?.reply || '';
        }

        if (!replyText) {
            contentArea.innerHTML = `<div class="empty-state">Agnes 正在小憩，暂时无法回答，请稍后再试～</div>`;
            return;
        }

        contentArea.innerHTML = `<div class="ai-advice-body" style="line-height:1.65; white-space:pre-wrap;">${escapeHtml(replyText)}</div>`;

        // 提取建议草稿用于一键应用
        if (applyBtn) {
            applyBtn.hidden = false;
            applyBtn.onclick = () => {
                closeAITopicAdviceModal();
                openResolveTopicModal();
                const resolveInput = document.getElementById('resolveSummaryInput');
                if (resolveInput) {
                    resolveInput.value = replyText;
                }
            };
        }
    } catch (err) {
        console.error('召唤 AI 建议异常:', err);
        const friendlyMsg = typeof getFriendlyAIError === 'function'
            ? getFriendlyAIError(err)
            : '获取建议失败，请检查网络后重试。';
        contentArea.innerHTML = `<div class="empty-state">${escapeHtml(friendlyMsg)}</div>`;
    } finally {
        isTopicAIRequesting = false;
    }
}

function closeAITopicAdviceModal() {
    const modal = document.getElementById('aiTopicAdviceModal');
    hideTopicModal(modal);
}

// ==========================================================================
// 8. 话题编辑、删除与心声撤回逻辑
// ==========================================================================

async function removeUploadedTopicObjects(pathsOrRefs) {
    if (typeof removeStorageObjects === 'function') {
        return removeStorageObjects(pathsOrRefs);
    }
    if (!Array.isArray(pathsOrRefs) || !pathsOrRefs.length || !supabaseClient) return;
    const paths = pathsOrRefs.map(val => {
        if (typeof extractStorageObjectPath === 'function') {
            return extractStorageObjectPath(val);
        }
        if (typeof val === 'string' && typeof STORAGE_REFERENCE_PREFIX === 'string' && val.startsWith(STORAGE_REFERENCE_PREFIX)) {
            return typeof getStorageObjectPath === 'function' ? getStorageObjectPath(val) : '';
        }
        return (typeof val === 'string' && !val.startsWith('http') && !val.includes('avatars')) ? val : '';
    }).filter(Boolean);
    if (!paths.length) return;
    const uniquePaths = Array.from(new Set(paths));
    try {
        const { error } = await supabaseClient.storage.from('photos').remove(uniquePaths);
        if (error) console.error('清理话题媒体失败:', error);
    } catch (err) {
        console.error('清理话题媒体异常:', err);
    }
}

let editingTopicId = null;
let selectedEditTopicCategory = 'general';
let selectedEditTopicStatus = 'open';

async function openEditTopicModal(topicId, event) {
    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }
    const id = topicId 
        || currentTopicDetail?.id 
        || window.currentTopicDetail?.id 
        || (window.currentAppRoute?.params?.id)
        || null;

    if (!id) {
        console.warn('openEditTopicModal: 缺少手账话题ID');
        return;
    }

    editingTopicId = id;

    // 尝试优先从内存缓存中寻找话题对象
    let topic = (homeTopicsList || []).find(t => String(t.id) === String(id))
        || (catalogTopicsList || []).find(t => String(t.id) === String(id))
        || (currentTopicDetail && String(currentTopicDetail.id) === String(id) ? currentTopicDetail : null)
        || (window.currentTopicDetail && String(window.currentTopicDetail.id) === String(id) ? window.currentTopicDetail : null);

    const modal = document.getElementById('editTopicModal');
    const input = document.getElementById('editTopicTitleInput');
    const summaryInput = document.getElementById('editTopicSummaryInput');
    const summaryField = document.getElementById('editTopicSummaryField');
    const msg = document.getElementById('editTopicModalMsg');

    if (!modal) return;

    if (input) input.value = topic ? (topic.title || '') : '';
    if (msg) msg.textContent = '';

    selectedEditTopicCategory = topic?.category || 'general';
    selectedEditTopicStatus = topic?.status || 'open';

    // 设置分类选中高亮
    document.querySelectorAll('#editCategoryRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.category === selectedEditTopicCategory);
    });

    // 设置状态单选高亮
    document.querySelectorAll('#editStatusRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.status === selectedEditTopicStatus);
    });

    // 设置共识约定输入框
    if (summaryInput) summaryInput.value = topic?.summary || '';
    if (summaryField) {
        summaryField.hidden = selectedEditTopicStatus !== 'resolved';
    }

    // 立即秒发展示弹窗，保证极佳交互响应
    showTopicModal(modal);

    // 如果未命中缓存，在后台异步拉取并补全
    if (!topic && supabaseClient) {
        try {
            const { data } = await supabaseClient
                .from('topics')
                .select('*')
                .eq('id', id)
                .single();
            if (data && String(editingTopicId) === String(id)) {
                topic = data;
                if (input) input.value = data.title || '';
                selectedEditTopicCategory = data.category || 'general';
                selectedEditTopicStatus = data.status || 'open';

                document.querySelectorAll('#editCategoryRadioGroup .category-radio-btn').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.category === selectedEditTopicCategory);
                });
                document.querySelectorAll('#editStatusRadioGroup .category-radio-btn').forEach(btn => {
                    btn.classList.toggle('selected', btn.dataset.status === selectedEditTopicStatus);
                });
                if (summaryInput) summaryInput.value = data.summary || '';
                if (summaryField) {
                    summaryField.hidden = selectedEditTopicStatus !== 'resolved';
                }
            }
        } catch (fetchErr) {
            console.warn('异步查询话题手账失败:', fetchErr);
        }
    }
}

function closeEditTopicModal() {
    const modal = document.getElementById('editTopicModal');
    hideTopicModal(modal);
    editingTopicId = null;
}

function selectEditTopicCategory(cat) {
    selectedEditTopicCategory = cat;
    document.querySelectorAll('#editCategoryRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.category === cat);
    });
}

function selectEditTopicStatus(status) {
    selectedEditTopicStatus = status;
    document.querySelectorAll('#editStatusRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.status === status);
    });

    const summaryField = document.getElementById('editTopicSummaryField');
    if (summaryField) {
        summaryField.hidden = status !== 'resolved';
    }
}

async function submitEditTopic() {
    if (!editingTopicId || !supabaseClient) return;

    const input = document.getElementById('editTopicTitleInput');
    const summaryInput = document.getElementById('editTopicSummaryInput');
    const msg = document.getElementById('editTopicModalMsg');
    const submitBtn = document.getElementById('btn-submit-edit-topic');

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) {
            if (msg) msg.textContent = '请先登录情侣空间后再修改手账 🌸';
            return;
        }
    }

    const title = input ? input.value.trim() : '';
    if (!title) {
        if (msg) msg.textContent = '请填写手账题目～';
        return;
    }

    const isResolved = selectedEditTopicStatus === 'resolved';
    const summary = summaryInput ? summaryInput.value.trim() : '';

    if (submitBtn) submitBtn.disabled = true;
    if (msg) msg.textContent = '正在保存修改... ✨';

    try {
        const updatePayload = {
            title: title,
            category: selectedEditTopicCategory,
            status: selectedEditTopicStatus,
            summary: isResolved ? (summary || null) : null,
            updated_at: new Date().toISOString()
        };

        if (isResolved) {
            updatePayload.resolved_at = new Date().toISOString();
            updatePayload.resolved_by = currentUserProfile.username;
        } else {
            updatePayload.resolved_at = null;
            updatePayload.resolved_by = null;
        }

        const { data, error } = await supabaseClient
            .from('topics')
            .update(updatePayload)
            .eq('id', editingTopicId)
            .eq('space_id', currentUserProfile.space_id)
            .select()
            .single();

        if (error) {
            console.error('更新手账失败:', error);
            if (msg) msg.textContent = '修改失败：' + (error.message || '未知错误');
            return;
        }

        // 如果当前在详情页且正是此话题，刷新详情页展示
        if (currentTopicDetail && String(currentTopicDetail.id) === String(editingTopicId)) {
            currentTopicDetail = data;
            window.currentTopicDetail = data;
            renderTopicDetailShell(data);
        }

        closeEditTopicModal();

        // 刷新列表
        loadHomeTopics();
        loadTopicsCatalog(activeTopicCategoryFilter);

        if (typeof showToast === 'function') {
            showToast('手账已更新 ✨');
        }
    } catch (err) {
        console.error('更新手账异常:', err);
        if (msg) msg.textContent = '保存异常，请稍后重试';
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

async function deleteTopic(topicId, event) {
    if (event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }
    const id = topicId 
        || currentTopicDetail?.id 
        || window.currentTopicDetail?.id 
        || (window.currentAppRoute?.params?.id)
        || null;
    if (!id || !supabaseClient) return;

    const idKey = String(id);
    if (deletingTopicIds.has(idKey)) return;

    if (!confirm('确定要删除这本手账话题吗？\n删除后里面所有的交流回忆都将抹去，不可恢复哦 🌸')) {
        return;
    }

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) {
            alert('请先登录情侣空间后再操作 🌸');
            return;
        }
    }

    deletingTopicIds.add(idKey);

    try {
        // 1. 收集待清理的媒体资源（从 messages 表中）
        const mediaToDelete = [];
        try {
            const { data: msgs } = await supabaseClient
                .from('topic_messages')
                .select('photos, audio_url')
                .eq('topic_id', id);

            if (Array.isArray(msgs)) {
                msgs.forEach(m => {
                    if (Array.isArray(m.photos)) mediaToDelete.push(...m.photos);
                    if (m.audio_url) mediaToDelete.push(m.audio_url);
                });
            }
        } catch (collectErr) {
            console.warn('收集话题媒体失败:', collectErr);
        }

        // 2. 从 topics 表删除（数据库外键级联删除关联消息）
        const { error } = await supabaseClient
            .from('topics')
            .delete()
            .eq('id', id)
            .eq('space_id', currentUserProfile.space_id);

        if (error) {
            console.error('删除手账失败:', error);
            if (typeof showToast === 'function') {
                showToast('删除手账失败：' + error.message);
            } else {
                alert('删除失败：' + error.message);
            }
            return;
        }

        // 3. 异步清理 Storage 媒体
        if (mediaToDelete.length > 0) {
            removeUploadedTopicObjects(mediaToDelete);
        }

        // 4. 关闭编辑弹窗（如果正开着）
        closeEditTopicModal();

        // 5. 如果当前在详情页且删除的是当前话题，退出详情页
        if (currentTopicDetail && String(currentTopicDetail.id) === String(id)) {
            closeTopicDetail();
        }

        // 6. 刷新首页和手账目录
        loadHomeTopics();
        loadTopicsCatalog(activeTopicCategoryFilter);

        if (typeof showToast === 'function') {
            showToast('手账已删除 🌸');
        }
    } catch (err) {
        console.error('删除话题异常:', err);
        alert('删除发生异常，请稍后重试');
    } finally {
        deletingTopicIds.delete(idKey);
    }
}

async function deleteTopicMessage(msgId) {
    if (!msgId || !supabaseClient || !currentAuthUser) return;

    const msgKey = String(msgId);
    if (deletingTopicMsgIds.has(msgKey)) return;

    if (!confirm('确定撤回这条心声留言吗？')) {
        return;
    }

    deletingTopicMsgIds.add(msgKey);

    try {
        const targetMsg = (currentTopicMessages || []).find(m => String(m.id) === msgKey);

        const { error } = await supabaseClient
            .from('topic_messages')
            .delete()
            .eq('id', msgId)
            .eq('user_id', currentAuthUser.id);

        if (error) {
            console.error('撤回消息失败:', error);
            if (typeof showToast === 'function') {
                showToast('撤回失败：' + error.message);
            } else {
                alert('撤回失败：' + error.message);
            }
            return;
        }

        // 异步清理媒体
        if (targetMsg) {
            const mediaToDelete = [];
            if (Array.isArray(targetMsg.photos)) mediaToDelete.push(...targetMsg.photos);
            if (targetMsg.audio_url) mediaToDelete.push(targetMsg.audio_url);
            if (mediaToDelete.length > 0) {
                removeUploadedTopicObjects(mediaToDelete);
            }
        }

        // 从当前消息列表过滤并增量移除节点，避免打断其他语音播放或导致图片闪烁
        currentTopicMessages = (currentTopicMessages || []).filter(m => String(m.id) !== msgKey);
        removeSingleTopicMessageFromFlow(msgId);

        if (typeof showToast === 'function') {
            showToast('已撤回心声留言 🌸');
        }
    } catch (err) {
        console.error('撤回消息异常:', err);
        alert('撤回异常，请稍后重试');
    } finally {
        deletingTopicMsgIds.delete(msgKey);
    }
}

// 导出全局供 router 和 html 调用
window.loadHomeTopics = loadHomeTopics;
window.loadTopicsCatalog = loadTopicsCatalog;
window.openTopicsCatalog = openTopicsCatalog;
window.closeTopicsCatalog = closeTopicsCatalog;
window.openNewTopicModal = openNewTopicModal;
window.closeNewTopicModal = closeNewTopicModal;
window.selectTopicCategory = selectTopicCategory;
window.submitCreateTopic = submitCreateTopic;
window.loadTopicDetail = loadTopicDetail;
window.closeTopicDetail = closeTopicDetail;
window.handleTopicTextKeyDown = handleTopicTextKeyDown;
window.openTopicPhotoPicker = openTopicPhotoPicker;
window.handleTopicPhotoSelect = handleTopicPhotoSelect;
window.removeTopicPhotoPreview = removeTopicPhotoPreview;
window.toggleTopicRecording = toggleTopicRecording;
window.stopTopicRecording = stopTopicRecording;
window.deleteTopicAudioPreview = deleteTopicAudioPreview;
window.sendTopicMessage = sendTopicMessage;
window.openResolveTopicModal = openResolveTopicModal;
window.closeResolveTopicModal = closeResolveTopicModal;
window.submitResolveTopic = submitResolveTopic;
window.requestAITopicAdvice = requestAITopicAdvice;
window.closeAITopicAdviceModal = closeAITopicAdviceModal;
window.openTopicPhotoLightbox = openTopicPhotoLightbox;
window.openTopicPhotoLightboxByIndex = openTopicPhotoLightboxByIndex;
window.openEditTopicModal = openEditTopicModal;
window.closeEditTopicModal = closeEditTopicModal;
window.selectEditTopicCategory = selectEditTopicCategory;
window.selectEditTopicStatus = selectEditTopicStatus;
window.submitEditTopic = submitEditTopic;
window.deleteTopic = deleteTopic;
window.deleteTopicMessage = deleteTopicMessage;
window.resetTopicsStateOnLogout = resetTopicsStateOnLogout;

function enterTopicsPage(_route) {
    loadTopicsCatalog();
}

function enterTopicDetailPage(route) {
    const topicId = route?.params?.id;
    if (topicId) {
        loadTopicDetail(topicId);
    }
}

function leaveTopicDetailPage(_route) {
    cleanupTopicRealtimeSubscription();
    resetTopicComposer();
    currentTopicDetail = null;
    window.currentTopicDetail = null;
    currentTopicMessages = [];
}

function leaveTopicsPage(_route) {
    // 退出目录页逻辑
}

window.enterTopicsPage = enterTopicsPage;
window.enterTopicDetailPage = enterTopicDetailPage;
window.leaveTopicsPage = leaveTopicsPage;
window.leaveTopicDetailPage = leaveTopicDetailPage;

// 初始化弹窗背景点击关闭监听
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTopicModalBackdropHandlers);
} else {
    initTopicModalBackdropHandlers();
}
