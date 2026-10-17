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

// Realtime 订阅通道
let topicRealtimeChannel = null;

// 多媒体暂存状态
let topicSelectedPhotos = [];
let topicPhotoPreviewUrls = new Set();
let isTopicRecording = false;
let topicMediaRecorder = null;
let topicAudioChunks = [];
let topicAudioBlob = null;
let topicAudioDurationTimer = null;
let topicRecordingSeconds = 0;
let topicRecordingStream = null;

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
 * 获取当前登录用户的专属存储路径前缀
 */
function getTopicStorageDirectory() {
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

// ==========================================================================
// 1. 首页板块逻辑
// ==========================================================================

async function loadHomeTopics() {
    const container = document.getElementById('home-topics-content');
    if (!container || !supabaseClient) return;

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('topics')
            .select('*')
            .eq('space_id', currentUserProfile.space_id)
            .order('updated_at', { ascending: false })
            .limit(4);

        if (error) {
            console.error('加载首页话题手账失败:', error);
            container.innerHTML = `<div class="empty-state">加载手账失败，请稍后刷新重试 🌸</div>`;
            return;
        }

        homeTopicsList = data || [];
        renderHomeTopics(homeTopicsList);
    } catch (err) {
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

        return `
            <div class="home-topic-card ${isResolved ? 'is-resolved' : ''}" onclick="appNavigate('/topics/${topic.id}')" role="button" tabindex="0">
                <div class="home-topic-card-header">
                    <div class="home-topic-header-tags">
                        <span class="topic-tag category-${escapeHtml(topic.category)}">${catInfo.label}</span>
                        ${statusHtml}
                    </div>
                    <div class="topic-card-actions" onclick="event.stopPropagation()">
                        <button class="topic-card-action-btn" type="button" onclick="openEditTopicModal(${topic.id}, event)" title="编辑手账" aria-label="编辑手账">✏️</button>
                        <button class="topic-card-action-btn danger" type="button" onclick="deleteTopic(${topic.id}, event)" title="删除手账" aria-label="删除手账">🗑️</button>
                    </div>
                </div>
                <h3 class="home-topic-card-title">${escapeHtml(topic.title)}</h3>
                ${summaryHtml}
                <div class="home-topic-card-footer">
                    <span class="home-topic-card-author">✍️ ${escapeHtml(topic.author)}</span>
                    <span class="home-topic-card-time">${formatTopicTime(topic.updated_at || topic.created_at)}</span>
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

    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) {
            listEl.innerHTML = `<div class="empty-state">请先登录情侣空间后再查看手账目录 🌸</div>`;
            return;
        }
    }

    listEl.innerHTML = `<div class="empty-state">正在翻开我们的手账目录… 📖</div>`;

    // 更新筛选胶囊高亮
    document.querySelectorAll('.topics-filter-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.category === category);
    });

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
        if (error) {
            listEl.innerHTML = `<div class="empty-state">加载手账目录失败，请稍后重试</div>`;
            return;
        }

        catalogTopicsList = data || [];
        renderTopicsCatalog(catalogTopicsList);
    } catch (err) {
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

        return `
            <div class="topic-list-card ${isResolved ? 'is-resolved' : ''}" onclick="appNavigate('/topics/${topic.id}')" role="button" tabindex="0">
                <div class="topic-list-card-top">
                    <div class="topic-list-card-top-tags">
                        <span class="topic-tag category-${escapeHtml(topic.category)}">${catInfo.label}</span>
                        ${statusHtml}
                    </div>
                    <div class="topic-card-actions" onclick="event.stopPropagation()">
                        <button class="topic-card-action-btn" type="button" onclick="openEditTopicModal(${topic.id}, event)" title="编辑手账" aria-label="编辑手账">✏️</button>
                        <button class="topic-card-action-btn danger" type="button" onclick="deleteTopic(${topic.id}, event)" title="删除手账" aria-label="删除手账">🗑️</button>
                    </div>
                </div>
                <div class="topic-list-card-title">${escapeHtml(topic.title)}</div>
                ${summaryHtml}
                <div class="topic-list-card-bottom">
                    <span>由 ${escapeHtml(topic.author)} 发起</span>
                    <span>${formatTopicTime(topic.updated_at || topic.created_at)}</span>
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

    if (typeof modal.showModal === 'function') {
        modal.showModal();
    } else {
        modal.setAttribute('open', '');
    }
}

function closeNewTopicModal() {
    const modal = document.getElementById('newTopicModal');
    if (modal) {
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }
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

    if (!input || !currentAuthUser || !currentUserProfile?.space_id) return;
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

    const titleEl = document.getElementById('topic-detail-title');
    const flowEl = document.getElementById('topic-messages-flow');
    if (titleEl) titleEl.textContent = '手账加载中…';
    if (flowEl) flowEl.innerHTML = '<div class="empty-state">正在展开这一页的对话回忆… 🌸</div>';

    // 确保认证信息就绪
    if (!currentUserProfile?.space_id || !currentAuthUser) {
        const authed = await ensureTopicAuthReady();
        if (!authed) {
            console.warn('loadTopicDetail: 未能获取到情侣空间认证信息');
            if (titleEl) titleEl.textContent = '请先登录';
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">请先登录情侣空间后再查看本手账哦～ 🌸</div>';
            return;
        }
    }

    try {
        // 1. 获取话题基本信息
        const { data: topic, error: topicErr } = await supabaseClient
            .from('topics')
            .select('*')
            .eq('id', topicId)
            .eq('space_id', currentUserProfile.space_id)
            .single();

        if (topicErr || !topic) {
            console.error('获取话题失败:', topicErr);
            if (titleEl) titleEl.textContent = '话题不存在或已删除';
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">话题不存在或已被删除 🌸</div>';
            return;
        }

        currentTopicDetail = topic;
        renderTopicDetailShell(topic);

        // 2. 获取该话题的消息记录
        const { data: messages, error: msgErr } = await supabaseClient
            .from('topic_messages')
            .select('*')
            .eq('topic_id', topicId)
            .eq('space_id', currentUserProfile.space_id)
            .order('created_at', { ascending: true });

        if (msgErr) {
            console.error('获取消息失败:', msgErr);
            if (flowEl) flowEl.innerHTML = '<div class="empty-state">加载消息流失败，请重试 🌸</div>';
            return;
        }

        currentTopicMessages = messages || [];
        await renderTopicMessages(currentTopicMessages);

        // 3. 订阅该话题的 Realtime 动态
        initTopicRealtimeSubscription(topicId);

        // 滚动到底部最新消息
        scrollTopicToBottom();
    } catch (err) {
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

    // 达成共识按钮
    if (resolveBtn) {
        if (topic.status === 'resolved') {
            resolveBtn.className = 'btn-resolve-topic is-resolved';
            resolveBtn.innerHTML = '✨ 编辑我们的共识';
        } else {
            resolveBtn.className = 'btn-resolve-topic';
            resolveBtn.innerHTML = '🤝 达成共识 / 记录方案';
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

async function renderTopicMessages(messages) {
    const flowEl = document.getElementById('topic-messages-flow');
    if (!flowEl) return;

    if (!messages || messages.length === 0) {
        flowEl.innerHTML = `
            <div class="empty-state" style="padding: 30px 10px;">
                💌 还没有发言呢～<br>在下方留言、发照片或录下想说的心声，开始我们的探讨吧！
            </div>
        `;
        return;
    }

    const rowsHtml = await Promise.all(messages.map(async msg => {
        const isSelf = msg.user_id === currentAuthUser?.id || msg.author === currentUserProfile?.username;
        const authorProfile = Object.values(allProfilesCache || {}).find(p => p.username === msg.author) || null;
        const avatarUrl = authorProfile?.avatar_url ? await resolveMediaUrl(authorProfile.avatar_url) : '';
        const avatarHtml = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(msg.author)}">`
            : (msg.author === '小奚' ? '🌸' : '🐍');

        // 文字内容
        let textBubbleHtml = '';
        if (msg.content && msg.content.trim()) {
            textBubbleHtml = `<div class="topic-message-bubble">${escapeHtml(msg.content)}</div>`;
        }

        // 图片内容
        let photosHtml = '';
        if (msg.photos && msg.photos.length > 0) {
            const resolvedPhotos = await Promise.all(msg.photos.map(ref => resolveMediaUrl(ref)));
            const photoItems = resolvedPhotos.map((url, idx) => `
                <div class="topic-message-photo-item" onclick="openTopicPhotoLightbox('${escapeHtml(url)}')">
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

        const deleteMsgBtnHtml = isSelf
            ? `<button class="topic-msg-action-btn" type="button" onclick="deleteTopicMessage(${msg.id})" title="撤回这条心声" aria-label="撤回心声">撤回</button>`
            : '';

        return `
            <div class="topic-message-row ${isSelf ? 'is-self' : ''}" data-msg-id="${msg.id}">
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
    }));

    flowEl.innerHTML = rowsHtml.join('');
}

function scrollTopicToBottom() {
    const scroller = document.querySelector('#topicDetailModal .app-page-scroll');
    if (scroller) {
        setTimeout(() => {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        }, 100);
    }
}

function openTopicPhotoLightbox(url) {
    if (typeof openLightbox === 'function') {
        openLightbox(url, 'image');
    }
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
                // 如果是新消息且列表中尚未包含
                const exists = currentTopicMessages.some(m => m.id === payload.new.id);
                if (!exists) {
                    currentTopicMessages.push(payload.new);
                    await renderTopicMessages(currentTopicMessages);
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
            async (payload) => {
                if (!payload?.old?.id) return;
                currentTopicMessages = currentTopicMessages.filter(m => m.id !== payload.old.id);
                await renderTopicMessages(currentTopicMessages);
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
    currentTopicMessages = [];
    appBack('/topics');
}

// ==========================================================================
// 5. 消息发送逻辑（富文本 + 图片 + 语音）
// ==========================================================================

function handleTopicTextKeyDown(event) {
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
        alert('最多只能选择 9 张照片哦～');
        return;
    }

    const previewContainer = document.getElementById('topicComposerPhotoPreviews');
    if (previewContainer) previewContainer.hidden = false;

    for (const file of files) {
        if (!file.type.startsWith('image/')) continue;
        topicSelectedPhotos.push(file);
        const objUrl = URL.createObjectURL(file);
        topicPhotoPreviewUrls.add(objUrl);

        const imgWrap = document.createElement('div');
        imgWrap.className = 'topic-composer-photo-preview-item';
        imgWrap.style.cssText = 'position:relative; width:56px; height:56px; border-radius:8px; overflow:hidden; display:inline-block; margin-right:6px;';
        imgWrap.innerHTML = `
            <img src="${objUrl}" style="width:100%; height:100%; object-fit:cover;">
            <button type="button" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:#fff; border:none; border-radius:50%; width:18px; height:18px; font-size:12px; cursor:pointer;" onclick="removeTopicPhotoPreview(this, '${objUrl}')">×</button>
        `;
        previewContainer.appendChild(imgWrap);
    }
    event.target.value = '';
}

function removeTopicPhotoPreview(btn, url) {
    if (btn && btn.parentElement) {
        btn.parentElement.remove();
    }
    URL.revokeObjectURL(url);
    topicPhotoPreviewUrls.delete(url);
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
        topicRecordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        audioPlayer.src = URL.createObjectURL(blob);
        previewWrap.hidden = false;
    }
}

function deleteTopicAudioPreview() {
    const previewWrap = document.getElementById('topicAudioPreviewWrap');
    const audioPlayer = document.getElementById('topicAudioPlayer');
    if (audioPlayer && audioPlayer.src) {
        URL.revokeObjectURL(audioPlayer.src);
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

let isTopicMessageSending = false;

// ---------------- 执行发送 ----------------
async function sendTopicMessage() {
    if (isTopicMessageSending) return;

    const textInput = document.getElementById('topicComposerTextInput');
    const sendBtn = document.getElementById('btn-topic-send');
    const text = textInput ? textInput.value.trim() : '';

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

    try {
        const storageDir = getTopicStorageDirectory();
        const uploadedPhotoRefs = [];
        let uploadedAudioRef = null;

        // 1. 上传图片
        if (hasPhotos) {
            for (let i = 0; i < topicSelectedPhotos.length; i++) {
                const file = topicSelectedPhotos[i];
                let uploadBlob = file;
                if (typeof compressImageFile === 'function') {
                    try {
                        uploadBlob = await compressImageFile(file);
                    } catch (_e) {
                        uploadBlob = file;
                    }
                }
                const ext = getMomentFileExtension(file);
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
            if (typeof showToast === 'function') {
                showToast('发送失败：' + error.message);
            } else {
                alert('发送失败：' + error.message);
            }
            return;
        }

        // 清理输入状态
        resetTopicComposer();

        // 本地立即追加（Realtime 会有去重）
        if (!currentTopicMessages.some(m => m.id === data.id)) {
            currentTopicMessages.push(data);
            await renderTopicMessages(currentTopicMessages);
            scrollTopicToBottom();
        }
    } catch (err) {
        console.error('发送话题消息异常:', err);
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

    if (typeof modal.showModal === 'function') {
        modal.showModal();
    } else {
        modal.setAttribute('open', '');
    }
}

function closeResolveTopicModal() {
    const modal = document.getElementById('resolveTopicModal');
    if (modal) {
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }
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
    if (!currentTopicDetail) return;
    const modal = document.getElementById('aiTopicAdviceModal');
    const contentArea = document.getElementById('aiTopicAdviceContent');
    const applyBtn = document.getElementById('btn-ai-apply-summary');
    if (!modal || !contentArea) return;

    contentArea.innerHTML = `<div class="ai-loading">🌸 正在请教感情助手 Agnes，请稍候… ✨</div>`;
    if (applyBtn) applyBtn.hidden = true;

    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');

    try {
        // 整理近期对话记录作为上下文
        const recentMessages = currentTopicMessages.slice(-10).map(m => `${m.author}: ${m.content || '[多媒体]'}`).join('\n');
        const prompt = `我们正在情侣小家的话题手账讨论「${currentTopicDetail.title}」（分类：${currentTopicDetail.category}）。\n以下是我们近期的沟通记录：\n${recentMessages}\n\n请作为我们温柔体贴的恋爱小助理，从客观、温和、充满爱意的角度给出：\n1. 调解与建议锦囊（如何更好互相理解与解决）；\n2. 一份建议的「达成共识与约定草稿」（50~150字，以情侣双方第一人称视角，充满仪式感）。`;

        // 调用现有 AI 接口
        const response = await supabaseClient.functions.invoke('ai-chat', {
            body: {
                message: prompt,
                history: [],
                model: 'agnes-2.0-flash'
            }
        });

        if (response.error || !response.data?.reply) {
            contentArea.innerHTML = `<div class="empty-state">Agnes 正在小憩，暂时无法回答，请稍后再试～</div>`;
            return;
        }

        const replyText = response.data.reply;
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
        contentArea.innerHTML = `<div class="empty-state">获取建议失败，请检查网络后重试。</div>`;
    }
}

function closeAITopicAdviceModal() {
    const modal = document.getElementById('aiTopicAdviceModal');
    if (modal) {
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }
}

// ==========================================================================
// 8. 话题编辑、删除与心声撤回逻辑
// ==========================================================================

async function removeUploadedTopicObjects(pathsOrRefs) {
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
    const id = topicId || currentTopicDetail?.id;
    if (!id) return;

    editingTopicId = id;

    // 尝试优先从缓存中寻找话题对象
    let topic = (homeTopicsList || []).find(t => String(t.id) === String(id))
        || (catalogTopicsList || []).find(t => String(t.id) === String(id))
        || (currentTopicDetail && String(currentTopicDetail.id) === String(id) ? currentTopicDetail : null);

    if (!topic && supabaseClient) {
        try {
            const { data } = await supabaseClient
                .from('topics')
                .select('*')
                .eq('id', id)
                .single();
            topic = data;
        } catch (_e) {}
    }

    if (!topic) {
        alert('未找到该话题数据');
        return;
    }

    const modal = document.getElementById('editTopicModal');
    const input = document.getElementById('editTopicTitleInput');
    const summaryInput = document.getElementById('editTopicSummaryInput');
    const summaryField = document.getElementById('editTopicSummaryField');
    const msg = document.getElementById('editTopicModalMsg');

    if (!modal) return;

    if (input) input.value = topic.title || '';
    if (msg) msg.textContent = '';

    selectedEditTopicCategory = topic.category || 'general';
    selectedEditTopicStatus = topic.status || 'open';

    // 设置分类选中高亮
    document.querySelectorAll('#editCategoryRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.category === selectedEditTopicCategory);
    });

    // 设置状态单选高亮
    document.querySelectorAll('#editStatusRadioGroup .category-radio-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.dataset.status === selectedEditTopicStatus);
    });

    // 设置共识约定输入框
    if (summaryInput) summaryInput.value = topic.summary || '';
    if (summaryField) {
        summaryField.hidden = selectedEditTopicStatus !== 'resolved';
    }

    if (typeof modal.showModal === 'function') {
        modal.showModal();
    } else {
        modal.setAttribute('open', '');
    }
}

function closeEditTopicModal() {
    const modal = document.getElementById('editTopicModal');
    if (modal) {
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
    }
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
    const id = topicId || currentTopicDetail?.id;
    if (!id || !supabaseClient) return;

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
    }
}

async function deleteTopicMessage(msgId) {
    if (!msgId || !supabaseClient || !currentAuthUser) return;

    if (!confirm('确定撤回这条心声留言吗？')) {
        return;
    }

    try {
        const targetMsg = (currentTopicMessages || []).find(m => String(m.id) === String(msgId));

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

        // 从当前消息列表过滤并重新渲染
        currentTopicMessages = (currentTopicMessages || []).filter(m => String(m.id) !== String(msgId));
        await renderTopicMessages(currentTopicMessages);

        if (typeof showToast === 'function') {
            showToast('已撤回心声留言 🌸');
        }
    } catch (err) {
        console.error('撤回消息异常:', err);
        alert('撤回异常，请稍后重试');
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
window.deleteTopicAudioPreview = deleteTopicAudioPreview;
window.sendTopicMessage = sendTopicMessage;
window.openResolveTopicModal = openResolveTopicModal;
window.closeResolveTopicModal = closeResolveTopicModal;
window.submitResolveTopic = submitResolveTopic;
window.requestAITopicAdvice = requestAITopicAdvice;
window.closeAITopicAdviceModal = closeAITopicAdviceModal;
window.openTopicPhotoLightbox = openTopicPhotoLightbox;
window.openEditTopicModal = openEditTopicModal;
window.closeEditTopicModal = closeEditTopicModal;
window.selectEditTopicCategory = selectEditTopicCategory;
window.selectEditTopicStatus = selectEditTopicStatus;
window.submitEditTopic = submitEditTopic;
window.deleteTopic = deleteTopic;
window.deleteTopicMessage = deleteTopicMessage;

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
    currentTopicMessages = [];
}

function leaveTopicsPage(_route) {
    // 退出目录页逻辑
}

window.enterTopicsPage = enterTopicsPage;
window.enterTopicDetailPage = enterTopicDetailPage;
window.leaveTopicsPage = leaveTopicsPage;
window.leaveTopicDetailPage = leaveTopicDetailPage;

// 注册全局路由响应钩子（兜底兼容）
const prevOnAppRouteEnter = window.onAppRouteEnter;
window.onAppRouteEnter = function(route, previous) {
    if (typeof prevOnAppRouteEnter === 'function') {
        try { prevOnAppRouteEnter(route, previous); } catch (_e) {}
    }
    if (route?.id === 'topics') {
        loadTopicsCatalog();
    } else if (route?.id === 'topic-detail' && route.params?.id) {
        loadTopicDetail(route.params.id);
    }
};

const prevOnAppRouteLeave = window.onAppRouteLeave;
window.onAppRouteLeave = function(current, next) {
    if (typeof prevOnAppRouteLeave === 'function') {
        try { prevOnAppRouteLeave(current, next); } catch (_e) {}
    }
    if (current?.id === 'topic-detail') {
        cleanupTopicRealtimeSubscription();
        resetTopicComposer();
        currentTopicDetail = null;
        currentTopicMessages = [];
    }
};
