// ==========================================
// AI 专属助手
// ==========================================
const AI_TABS = new Set(['topic', 'anniversary', 'summary']);
const CHAT_SYSTEM_PROMPT = '你是 Agnes 2.0，也是小蛇和小奚的专属情感小助理，语气温暖、俏皮、可爱。帮助他们聊天解闷、提供恋爱建议、推荐约会点子、化解小矛盾或分析本轮附带的图片。回答简洁温馨，每次不超过200字。图片不会在轮次之间保留；当前请求没有附图却追问图片时，请明确提醒用户重新选择图片，不要猜测。';
const AI_SERVICE_CONSENT_PREFIX = 'ai_service_consent_agnes_2_0_v1_';
const AGNES_PROVIDER = 'agnes';
const AGNES_MODEL = 'agnes-2.0-flash';
const AGNES_PROMPT_VERSION = 2;
const AGNES_CONSENT_VERSION = 'agnes-2.0-v1';
const AI_INPUT_BUCKET = 'ai-inputs';
const AI_MAX_ATTACHMENTS = 9;
const AI_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AI_MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024;
const AI_DIARY_PAGE_SIZE = 20;
const AI_SUMMARY_STORY_MAX_CHARACTERS = 3800;
const AI_STALE_UPLOAD_AGE_MS = 15 * 60 * 1000;
const AI_LOGOUT_UPLOAD_DRAIN_TIMEOUT_MS = 10 * 1000;
const AI_DEFAULT_IMAGE_PROMPT = '请描述并分析这些图片中的关键信息';
const AI_PUBLIC_PHOTO_PATH_PREFIX = '/storage/v1/object/public/photos/';
const AI_IMAGE_EXTENSIONS = new Map([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp']
]);
let currentAITab = 'topic';
let chatHistory = [];
let isChatSending = false;
let activeChatRequestId = 0;
let aiInteractionGeneration = 0;
let pendingChatAttachments = [];
let aiAttachmentSequence = 0;
let aiDiaryPickerOffset = 0;
let aiDiaryPickerHasMore = true;
let isAIDiaryPickerLoading = false;
let aiDiaryPickerRequestId = 0;
let aiUploadGeneration = 0;
const activeAIUploadPaths = new Set();
const activeAIUploadTasks = new Set();
const aiDiaryPickerRenderedKeys = new Set();

function getAIServiceConsentKey() {
    return currentAuthUser?.id ? `${AI_SERVICE_CONSENT_PREFIX}${currentAuthUser.id}` : '';
}

function hasAIServiceConsent() {
    const key = getAIServiceConsentKey();
    return Boolean(key && localStorage.getItem(key) === 'granted');
}

function syncAIPrivacySetting() {
    const checkbox = document.getElementById('ai-service-consent');
    if (checkbox) checkbox.checked = hasAIServiceConsent();
}

function setAIServiceConsent(enabled) {
    const key = getAIServiceConsentKey();
    if (!key) return;

    aiInteractionGeneration += 1;
    activeChatRequestId += 1;
    if (enabled) localStorage.setItem(key, 'granted');
    else {
        localStorage.removeItem(key);
        chatHistory = [];
        isChatSending = false;
        clearPendingChatAttachments();
        closeAIDiaryPicker();
        resetAIDiaryPicker();
        resetAIChatMessages();
        setAIChatComposerBusy(false);
    }
    syncAIPrivacySetting();
    if (typeof showToast === 'function') {
        showToast(enabled ? 'Agnes 2.0 服务已开启，可随时在设置中关闭。' : 'Agnes 2.0 服务已关闭，不会再发送文字或图片。');
    }
}

function assertAIConsent() {
    if (hasAIServiceConsent()) return;
    throw new Error('AI_CONSENT_REQUIRED');
}

function assertAIAuthenticated() {
    if (isAuthenticated()) return;
    throw new Error('AUTH_REQUIRED');
}

function readAIResponse(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('AI_EMPTY_RESPONSE');
    }
    return content.trim();
}

function createAIError(code, cause = null) {
    const error = new Error(code);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
}

function getAIErrorCodeFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return '';
    for (const key of ['error', 'code', 'error_code']) {
        const value = typeof payload[key] === 'string' ? payload[key].trim() : '';
        if (/^[A-Z][A-Z0-9_]{2,80}$/.test(value)) return value;
    }
    return '';
}

async function getAIInvocationErrorCode(error) {
    const directCode = getAIErrorCodeFromPayload(error);
    if (directCode) return directCode;

    const context = error?.context;
    if (context && typeof context.clone === 'function') {
        try {
            const payload = await context.clone().json();
            const code = getAIErrorCodeFromPayload(payload);
            if (code) return code;
        } catch (_error) {
            // A non-JSON Functions error is mapped to the generic request failure below.
        }
    }

    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    return /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : '';
}

async function invokeAI(messages, attachments = []) {
    assertAIAuthenticated();
    assertAIConsent();
    const body = { messages };
    if (attachments.length > 0) body.attachments = attachments;
    const { data, error } = await supabaseClient.functions.invoke('ai-chat', {
        headers: { 'x-agnes-consent-version': AGNES_CONSENT_VERSION },
        body
    });
    if (error) {
        const code = await getAIInvocationErrorCode(error);
        throw createAIError(code || 'AI_REQUEST_FAILED', error);
    }
    const responseErrorCode = getAIErrorCodeFromPayload(data);
    if (responseErrorCode) throw createAIError(responseErrorCode);
    return readAIResponse(data);
}

function callAgnes(systemPrompt, userPrompt) {
    return invokeAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]);
}

function callAgnesChat(messages, attachments = []) {
    return invokeAI(messages, attachments);
}

function normalizeAIErrorCode(error) {
    const candidate = String(error?.code || error?.message || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9_]{2,80}$/.test(candidate) ? candidate : 'AI_REQUEST_FAILED';
}

function getFriendlyAIError(error) {
    const code = normalizeAIErrorCode(error);
    const messages = {
        AI_CONSENT_REQUIRED: '请先在“头像 → 设置 → AI 隐私”中开启 Agnes 2.0。',
        AGNES_CONSENT_VERSION_REQUIRED: '请刷新或重新打开网站，阅读新版 Agnes 2.0 隐私说明后再开启服务。',
        AUTH_REQUIRED: '登录状态已失效，请重新登录后再试。',
        AUTH_INVALID: '登录状态已失效，请重新登录后再试。',
        INVALID_TOKEN: '登录状态已失效，请重新登录后再试。',
        UNAUTHORIZED: '登录状态已失效，请重新登录后再试。',
        PROFILE_NOT_FOUND: '暂时找不到你的空间资料，请重新登录后再试。',
        PROFILE_UNMAPPED: '你的账号还没有关联共享空间，请先完成空间配置。',
        MEMBERSHIP_REQUIRED: '你目前无权访问这个共享空间。',
        FORBIDDEN: '你目前无权访问所选内容。',
        ORIGIN_NOT_ALLOWED: '当前页面来源未获授权，请从正式网站打开。',
        SERVICE_MAINTENANCE: 'Agnes 2.0 正在安全维护中，请稍后再试。',
        SERVICE_MISCONFIGURED: 'Agnes 2.0 服务尚未配置完成，请联系管理员。',
        INVALID_REQUEST: '请求内容格式不正确，请重新选择后再试。',
        INVALID_REQUEST_FIELDS: '请求内容格式不正确，请刷新页面后重试。',
        INVALID_JSON: '请求内容格式不正确，请刷新页面后重试。',
        JSON_REQUIRED: '请求内容格式不正确，请刷新页面后重试。',
        METHOD_NOT_ALLOWED: '当前请求方式不受支持，请刷新页面后重试。',
        INVALID_MESSAGES: '消息格式不正确，请修改后再试。',
        INVALID_MESSAGES_COUNT: '对话轮次太多，请关闭聊天窗口后重新开始。',
        INVALID_MESSAGE: '有一条消息格式不正确，请重新发送。',
        INVALID_MESSAGE_FIELDS: '有一条消息格式不正确，请刷新页面后重试。',
        INVALID_MESSAGE_ROLE: '有一条消息角色无效，请刷新页面后重试。',
        INVALID_MESSAGE_CONTENT: '消息不能为空。',
        MESSAGE_TOO_LONG: '消息内容太长，请缩短后再试。',
        MESSAGES_TOO_LONG: '当前对话太长，请关闭聊天窗口后重新开始。',
        INVALID_ATTACHMENT: '有一张图片的引用无效，请移除后重新选择。',
        ATTACHMENTS_REQUIRE_USER_MESSAGE: '请为图片补充一句问题后再试。',
        ATTACHMENT_LOOKUP_FAILED: '暂时无法读取日记图片，请稍后重试。',
        INVALID_MOMENT_ID: '有一条日记引用无效，请移除对应图片后重试。',
        INVALID_IMAGE_INDEX: '有一张日记图片的下标无效，请重新选择。',
        TOO_MANY_ATTACHMENTS: '单次最多只能选择 9 张图片。',
        UNSUPPORTED_IMAGE_TYPE: '仅支持 JPEG、PNG 和 WebP 图片。',
        IMAGE_UNSUPPORTED_TYPE: '仅支持 JPEG、PNG 和 WebP 图片。',
        INVALID_IMAGE_TYPE: '仅支持 JPEG、PNG 和 WebP 图片。',
        IMAGE_CONTENT_MISMATCH: '图片内容与文件格式不一致，请重新导出为 JPEG、PNG 或 WebP 后再试。',
        IMAGE_TOO_LARGE: '有图片超过 10 MiB，请换一张更小的图片。',
        TOTAL_IMAGE_SIZE_EXCEEDED: '图片总大小超过 40 MiB，请减少图片后重试。',
        IMAGES_TOTAL_TOO_LARGE: '图片总大小超过 40 MiB，请减少图片后重试。',
        IMAGES_TOO_LARGE: '图片总大小超过 40 MiB，请减少图片后重试。',
        IMAGE_NOT_FOUND: '有一张图片已不存在，请移除后重新选择。',
        IMAGE_UNAVAILABLE: '有一张图片已不存在或暂时无法读取，请移除后重新选择。',
        ATTACHMENT_NOT_FOUND: '有一张图片已不存在，请移除后重新选择。',
        IMAGE_FORBIDDEN: '你无权使用其中一张日记图片。',
        ATTACHMENT_FORBIDDEN: '你无权使用其中一张日记图片。',
        INVALID_TEMPORARY_PATH: '临时图片路径无效，请重新选择本地图片。',
        TEMPORARY_PATH_FORBIDDEN: '临时图片不属于当前账号，请重新选择。',
        REQUEST_TOO_LARGE: '本次请求太大，请减少文字或图片后再试。',
        RATE_LIMITED: '请求有点频繁，请稍后再试。',
        QUOTA_EXCEEDED: '今天的 Agnes 2.0 使用次数已达上限，明天再来吧。',
        QUOTA_CHECK_FAILED: '暂时无法检查使用次数，请稍后再试。',
        PROVIDER_TIMEOUT: 'Agnes 2.0 响应超时，请稍后再试。',
        CLIENT_CLOSED_REQUEST: '本次请求已取消，请重新发送。',
        PROVIDER_AUTH_FAILED: 'Agnes 2.0 密钥无效或无权调用当前模型，请在 Agnes 控制台重新生成并更新密钥。',
        PROVIDER_KEY_INVALID_FORMAT: 'Agnes 2.0 密钥格式不正确；Secret 的值只能填写密钥本身。',
        PROVIDER_BILLING_REQUIRED: 'Agnes 2.0 当前账号尚未开通所需套餐或额度。',
        PROVIDER_RATE_LIMITED: 'Agnes 2.0 上游请求过于频繁，请稍后再试。',
        PROVIDER_REQUEST_REJECTED: 'Agnes 2.0 拒绝了当前请求，请稍后重试或减少图片数量。',
        PROVIDER_DNS_ERROR: 'Supabase 暂时无法解析 Agnes 2.0 服务地址，请稍后再试。',
        PROVIDER_TLS_ERROR: 'Supabase 与 Agnes 2.0 的安全连接失败，请稍后再试。',
        PROVIDER_CONNECT_ERROR: 'Supabase 暂时无法连接 Agnes 2.0，请稍后再试。',
        PROVIDER_NETWORK_ERROR: 'Supabase 与 Agnes 2.0 之间的网络请求失败，请稍后再试。',
        PROVIDER_UNAVAILABLE: 'Agnes 2.0 暂时不可用，请稍后再试。',
        PROVIDER_ERROR: 'Agnes 2.0 暂时没有成功处理请求，请稍后再试。',
        INVALID_PROVIDER_RESPONSE: 'Agnes 2.0 返回了无法读取的内容，请稍后重试。',
        EMPTY_PROVIDER_RESPONSE: 'Agnes 2.0 没有返回有效内容，请稍后重试。',
        PROVIDER_MISCONFIGURED: 'Agnes 2.0 服务尚未配置完成，请联系管理员。',
        SERVER_MISCONFIGURED: 'AI 服务尚未配置完成，请联系管理员。',
        INTERNAL_ERROR: 'AI 服务暂时发生内部错误，请稍后重试。',
        AI_UPLOAD_FAILED: '图片上传失败，请检查网络后重试。',
        AI_EMPTY_RESPONSE: 'Agnes 2.0 没有返回有效内容，请稍后重试。',
        AI_REQUEST_FAILED: '暂时无法连接 Agnes 2.0，请稍后重试。'
    };
    return messages[code] || 'Agnes 2.0 暂时开小差了，请稍后再试。';
}

function shouldDiscardFailedAIAttachments(error) {
    const code = normalizeAIErrorCode(error);
    return new Set([
        'AUTH_REQUIRED',
        'AUTH_INVALID',
        'INVALID_TOKEN',
        'INVALID_ATTACHMENT',
        'INVALID_MOMENT_ID',
        'INVALID_IMAGE_INDEX',
        'INVALID_TEMPORARY_PATH',
        'TEMPORARY_PATH_FORBIDDEN',
        'ATTACHMENT_FORBIDDEN',
        'IMAGE_FORBIDDEN',
        'IMAGE_UNAVAILABLE',
        'IMAGE_NOT_FOUND',
        'ATTACHMENT_NOT_FOUND',
        'UNSUPPORTED_IMAGE_TYPE',
        'IMAGE_UNSUPPORTED_TYPE',
        'INVALID_IMAGE_TYPE',
        'IMAGE_CONTENT_MISMATCH'
    ]).has(code);
}

function setAIContent(message, state = '') {
    const contentArea = document.getElementById('aiContentArea');
    if (!contentArea) return;
    contentArea.replaceChildren();

    const content = document.createElement('div');
    content.className = state === 'loading' ? 'ai-loading' : `ai-result${state ? ` ${state}` : ''}`;
    content.textContent = message;
    contentArea.appendChild(content);
}

function openAIModal() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    document.getElementById('aiModal')?.showModal();
    switchAITab('topic');
}

function closeAIModal() {
    const modal = document.getElementById('aiModal');
    if (modal?.open) modal.close();
}

function toggleFabMenu() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    const menu = document.getElementById('fab-menu');
    const button = document.getElementById('fab-main');
    if (!menu) return;
    const expanded = !menu.classList.contains('show');
    menu.classList.toggle('show', expanded);
    button?.setAttribute('aria-expanded', String(expanded));
}

async function refreshAIContent() {
    if (!isAuthenticated()) return;
    const refreshButton = document.getElementById('aiRefreshBtn');
    if (!refreshButton || refreshButton.classList.contains('spinning')) return;
    refreshButton.classList.add('spinning');
    refreshButton.disabled = true;
    try {
        await switchAITab(currentAITab, true);
    } finally {
        refreshButton.classList.remove('spinning');
        refreshButton.disabled = false;
    }
}

function updateAITabState(tabName) {
    document.querySelectorAll('.ai-tab').forEach(button => {
        const active = button.id === `ai-tab-${tabName}`;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
    });
}

function extractStoryText(moment) {
    if (moment.type === 'text') return String(moment.content || '').trim();
    if (moment.type !== 'moment') return '';
    try {
        const parsed = JSON.parse(moment.content);
        return typeof parsed.text === 'string' ? parsed.text.trim() : '';
    } catch (_error) {
        return '';
    }
}

async function loadRecentStoryLog() {
    const spaceId = currentUserProfile?.space_id;
    if (!spaceId) throw createAIError('PROFILE_UNMAPPED');

    const { data, error } = await supabaseClient
        .from('moments')
        .select('author, user_id, type, content, created_at')
        .eq('space_id', spaceId)
        .eq('user_id', currentAuthUser.id)
        .in('type', ['text', 'moment'])
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) throw error;

    return (data || [])
        .map(moment => ({ ...moment, storyText: extractStoryText(moment) }))
        .filter(moment => moment.storyText)
        .reverse()
        .map(moment => {
            const shortText = moment.storyText.length > 160
                ? `${moment.storyText.slice(0, 160)}…`
                : moment.storyText;
            return `${moment.author || '成员'}：${shortText}`;
        })
        .join('\n')
        .slice(0, AI_SUMMARY_STORY_MAX_CHARACTERS);
}

async function getCachedAIContent(tabName) {
    const spaceId = currentUserProfile?.space_id;
    if (!spaceId) throw createAIError('PROFILE_UNMAPPED');

    const validSince = new Date();
    if (tabName === 'summary') validSince.setDate(validSince.getDate() - 7);
    else validSince.setHours(0, 0, 0, 0);

    let query = supabaseClient
        .from('ai_content')
        .select('content, created_at')
        .eq('space_id', spaceId)
        .eq('type', tabName)
        .eq('provider', AGNES_PROVIDER)
        .eq('model', AGNES_MODEL)
        .eq('prompt_version', AGNES_PROMPT_VERSION)
        .gte('created_at', validSince.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);
    if (tabName === 'summary') query = query.eq('created_by', currentAuthUser.id);

    const { data, error } = await query;
    if (error) throw error;
    return data?.[0]?.content || '';
}

async function cacheAIContent(tabName, content) {
    const { error } = await supabaseClient
        .from('ai_content')
        .insert([{
            type: tabName,
            content,
            provider: AGNES_PROVIDER,
            model: AGNES_MODEL,
            prompt_version: AGNES_PROMPT_VERSION
        }]);
    if (error) console.error('缓存 Agnes 2.0 内容失败:', error);
}

async function switchAITab(tabName, forceRefresh = false) {
    if (!AI_TABS.has(tabName)) return;
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }

    currentAITab = tabName;
    updateAITabState(tabName);
    setAIContent('思考中，请稍候... ✨', 'loading');

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const interactionGeneration = aiInteractionGeneration;
    const stillCurrent = () => isCurrentAuthSnapshot(epoch, userId)
        && aiInteractionGeneration === interactionGeneration
        && currentAITab === tabName;

    try {
        if (!forceRefresh) {
            const cached = await getCachedAIContent(tabName);
            if (!stillCurrent()) return;
            if (cached) {
                setAIContent(cached);
                return;
            }
        }

        if (!hasAIServiceConsent()) {
            setAIContent('AI 服务默认关闭。请先在“头像 → 设置 → AI 隐私”中阅读说明并主动开启。');
            return;
        }

        let generatedText = '';
        if (tabName === 'topic') {
            generatedText = await callAgnes(
                '你是一个温暖、可爱的情感小助手，为一对情侣提供能增进感情、唤起回忆的互动话题。',
                '请生成今天的一个互动话题。直接输出话题，亲切俏皮，200字以内。'
            );
        } else if (tabName === 'anniversary') {
            const now = new Date();
            let anniversary = new Date(now.getFullYear(), 4, 23);
            if (now > anniversary) anniversary = new Date(now.getFullYear() + 1, 4, 23);
            const days = Math.ceil((anniversary - now) / 86400000);
            if (days > 7) {
                if (stillCurrent()) setAIContent(`距离下一个纪念日（5月23日）还有 ${days} 天。剩下 7 天时再来领取专属倒计时情话吧~ 💖`);
                return;
            }
            generatedText = await callAgnes(
                `你是爱情文案助手。这对情侣将在 ${days} 天后迎来相爱纪念日。`,
                '写一段真挚、克制的纪念日倒计时文案，300字以内。'
            );
        } else {
            const storyLog = await loadRecentStoryLog();
            if (!stillCurrent()) return;
            if (!storyLog) {
                setAIContent('目前还没有足够的文字记录。多写一些日记，下周再来生成故事总结吧！');
                return;
            }
            generatedText = await callAgnes(
                '你是情侣回忆的记录员。根据提供的近期日记，以回忆守护者的第一人称总结生活片段；不虚构未提供的事实。',
                `近期日记：\n${storyLog}\n\n请写一篇温情的近期故事总结，400字以内。`
            );
        }

        if (!stillCurrent()) return;
        setAIContent(generatedText);
        await cacheAIContent(tabName, generatedText);
    } catch (error) {
        if (error.message === 'AUTH_REQUIRED' || !stillCurrent()) return;
        if (error.message === 'AI_CONSENT_REQUIRED') {
            setAIContent('AI 服务默认关闭。请先在“头像 → 设置 → AI 隐私”中阅读说明并主动开启。');
            return;
        }
        console.error('Agnes 2.0 模块出错:', normalizeAIErrorCode(error));
        setAIContent(getFriendlyAIError(error), 'error');
    }
}

// ==========================================
// Agnes 2.0 对话与图片（仅保存在当前页面内）
// ==========================================
function createAIChatWelcome() {
    const welcome = document.createElement('div');
    welcome.className = 'ai-chat-welcome';
    const lines = [
        '🌸 嗨~ 我是 Agnes 2.0，你们的专属情感小助理！',
        '可以聊日常，也可以选择图片让我帮你分析。',
        '图片只用于当前这一轮，继续追问时需要重新选择。',
        '💕 随时为你们服务！'
    ];
    lines.forEach((line, index) => {
        if (index > 0) welcome.appendChild(document.createElement('br'));
        welcome.appendChild(document.createTextNode(line));
    });
    return welcome;
}

function ensureAIChatWelcome() {
    const container = document.getElementById('aiChatMessages');
    if (container && !container.hasChildNodes()) container.appendChild(createAIChatWelcome());
}

function resetAIChatMessages() {
    const container = document.getElementById('aiChatMessages');
    if (!container) return;
    container.replaceChildren(createAIChatWelcome());
}

function openAIChatModal() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    bindAIChatModalLifecycle();
    ensureAIChatWelcome();
    renderPendingChatAttachments();
    const modal = document.getElementById('aiChatOverlay');
    if (modal && !modal.open) modal.showModal();
    document.getElementById('aiChatInput')?.focus();
}

function closeAIChatModal() {
    closeAIDiaryPicker();
    resetAIDiaryPicker();
    clearPendingChatAttachments();
    const modal = document.getElementById('aiChatOverlay');
    if (modal?.open) modal.close();
}

function bindAIChatModalLifecycle() {
    const modal = document.getElementById('aiChatOverlay');
    if (!modal || modal.dataset.aiLifecycleBound === 'true') return;
    modal.dataset.aiLifecycleBound = 'true';
    modal.addEventListener('close', () => {
        closeAIDiaryPicker();
        resetAIDiaryPicker();
        clearPendingChatAttachments();
    });
}

function handleChatKeyDown(event) {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function appendChatMessage(role, message, attachmentCount = 0) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return null;
    container.querySelector('.ai-chat-welcome')?.remove();

    const messageElement = document.createElement('div');
    messageElement.className = `chat-msg ${role === 'user' ? 'user' : 'ai'}`;
    if (role === 'user' && attachmentCount > 0) {
        const attachmentLabel = document.createElement('div');
        attachmentLabel.className = 'chat-msg-attachment-label';
        attachmentLabel.textContent = `🖼️ 本轮已选择 ${attachmentCount} 张图片`;
        messageElement.appendChild(attachmentLabel);

        const messageText = document.createElement('div');
        messageText.textContent = message;
        messageElement.appendChild(messageText);
    } else {
        messageElement.textContent = message;
    }
    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
    return messageElement;
}

function getPendingLocalImageBytes(attachments = pendingChatAttachments) {
    return attachments.reduce((total, attachment) => {
        return total + (attachment.source === 'temporary' && attachment.file
            ? Number(attachment.file.size || 0)
            : 0);
    }, 0);
}

function getMomentAttachmentKey(momentId, imageIndex) {
    return `moment:${String(momentId)}:${Number(imageIndex)}`;
}

function revokeAIAttachmentPreview(attachment) {
    if (!attachment?.revokePreview || !attachment.previewUrl) return;
    try {
        URL.revokeObjectURL(attachment.previewUrl);
    } catch (_error) {
        // Object URL cleanup is best effort.
    }
}

function getSafeAIPreviewUrl(attachment) {
    if (!attachment?.previewUrl) return '';
    if (typeof sanitizeMediaUrl === 'function') {
        return sanitizeMediaUrl(attachment.previewUrl, { allowBlob: attachment.source === 'temporary' });
    }
    return attachment.source === 'temporary' && attachment.previewUrl.startsWith('blob:')
        ? attachment.previewUrl
        : '';
}

function renderPendingChatAttachments() {
    const container = document.getElementById('aiAttachmentPreview');
    const count = document.getElementById('aiAttachmentCount');
    const localButton = document.getElementById('aiLocalImageBtn');
    const localInput = document.getElementById('aiLocalImageInput');
    if (count) count.textContent = `${pendingChatAttachments.length} / ${AI_MAX_ATTACHMENTS}`;
    const localSelectionDisabled = isChatSending
        || pendingChatAttachments.length >= AI_MAX_ATTACHMENTS;
    if (localButton) localButton.disabled = localSelectionDisabled;
    if (localInput) localInput.disabled = localSelectionDisabled;
    if (!container) {
        syncAIDiaryPickerSelectionState();
        return;
    }

    container.replaceChildren();
    pendingChatAttachments.forEach((attachment, index) => {
        const previewUrl = getSafeAIPreviewUrl(attachment);
        if (!previewUrl) return;

        const item = document.createElement('div');
        item.className = 'ai-attachment-item';

        const image = document.createElement('img');
        image.src = previewUrl;
        image.alt = `待发送图片 ${index + 1}`;
        image.loading = 'lazy';

        const source = document.createElement('span');
        source.className = 'ai-attachment-source';
        source.textContent = attachment.source === 'temporary'
            ? (attachment.label || '本地')
            : (attachment.label || '日记');

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'ai-attachment-remove';
        remove.textContent = '×';
        remove.setAttribute('aria-label', `移除待发送图片 ${index + 1}`);
        remove.disabled = isChatSending;
        remove.addEventListener('click', () => removePendingChatAttachment(attachment.id));

        item.append(image, source, remove);
        container.appendChild(item);
    });
    container.hidden = pendingChatAttachments.length === 0;
    syncAIDiaryPickerSelectionState();
}

function clearPendingChatAttachments() {
    pendingChatAttachments.forEach(revokeAIAttachmentPreview);
    pendingChatAttachments = [];
    const input = document.getElementById('aiLocalImageInput');
    if (input) input.value = '';
    renderPendingChatAttachments();
}

function removePendingChatAttachment(attachmentId) {
    if (isChatSending) return;
    const index = pendingChatAttachments.findIndex(attachment => attachment.id === attachmentId);
    if (index < 0) return;
    const [removed] = pendingChatAttachments.splice(index, 1);
    revokeAIAttachmentPreview(removed);
    renderPendingChatAttachments();
}

function notifyAIImageSelection(message) {
    if (typeof showToast === 'function') showToast(message, 4500);
}

function openAILocalImagePicker() {
    if (isChatSending) return;
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    if (!hasAIServiceConsent()) {
        notifyAIImageSelection('请先在“头像 → 设置 → AI 隐私”中开启 Agnes 2.0。');
        return;
    }
    document.getElementById('aiLocalImageInput')?.click();
}

function handleAILocalImageSelect(event) {
    const input = event?.target;
    const files = Array.from(input?.files || []);
    if (input) input.value = '';
    if (files.length === 0 || isChatSending) return;
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    if (!hasAIServiceConsent()) {
        notifyAIImageSelection('请先在“头像 → 设置 → AI 隐私”中开启 Agnes 2.0。');
        return;
    }

    let localBytes = getPendingLocalImageBytes();
    let rejectedType = false;
    let rejectedSize = false;
    let rejectedTotal = false;
    let rejectedCount = false;

    for (const file of files) {
        if (pendingChatAttachments.length >= AI_MAX_ATTACHMENTS) {
            rejectedCount = true;
            break;
        }
        if (!AI_IMAGE_EXTENSIONS.has(file.type)) {
            rejectedType = true;
            continue;
        }
        if (!Number.isFinite(file.size) || file.size <= 0 || file.size > AI_MAX_IMAGE_BYTES) {
            rejectedSize = true;
            continue;
        }
        if (localBytes + file.size > AI_MAX_TOTAL_IMAGE_BYTES) {
            rejectedTotal = true;
            continue;
        }

        const previewUrl = URL.createObjectURL(file);
        pendingChatAttachments.push({
            id: `local-${++aiAttachmentSequence}`,
            source: 'temporary',
            file,
            label: file.name || '本地图片',
            previewUrl,
            revokePreview: true
        });
        localBytes += file.size;
    }

    renderPendingChatAttachments();
    if (rejectedCount) notifyAIImageSelection('单次最多选择 9 张图片。');
    else if (rejectedTotal) notifyAIImageSelection('本地图片总大小不能超过 40 MiB。');
    else if (rejectedSize) notifyAIImageSelection('每张图片须小于等于 10 MiB，且不能是空文件。');
    else if (rejectedType) notifyAIImageSelection('仅支持 JPEG、PNG 和 WebP 图片。');
}

function getAIImageReferencePath(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const trimmed = value.trim();
    if (typeof getStorageObjectPath === 'function') {
        const storagePath = getStorageObjectPath(trimmed);
        if (storagePath) return storagePath;
    }
    try {
        const mediaUrl = new URL(trimmed);
        const projectUrl = new URL(SUPABASE_URL);
        if (mediaUrl.protocol !== 'https:'
            || mediaUrl.origin !== projectUrl.origin
            || mediaUrl.search
            || mediaUrl.hash
            || !mediaUrl.pathname.startsWith(AI_PUBLIC_PHOTO_PATH_PREFIX)) {
            return '';
        }
        return decodeURIComponent(mediaUrl.pathname.slice(AI_PUBLIC_PHOTO_PATH_PREFIX.length));
    } catch (_error) {
        return '';
    }
}

function isSupportedAIDiaryImage(value) {
    const path = getAIImageReferencePath(value).split(/[?#]/, 1)[0].toLowerCase();
    return /\.(?:jpe?g|png|webp)$/.test(path);
}

function extractAIDiaryImages(moment) {
    const momentId = String(moment?.id || '');
    if (!/^[1-9]\d*$/.test(momentId)) return [];
    if (moment.type === 'photo') {
        return isSupportedAIDiaryImage(moment.content)
            ? [{
                moment_id: momentId,
                image_index: 0,
                reference: moment.content,
                author: moment.author,
                created_at: moment.created_at
            }]
            : [];
    }
    if (moment.type !== 'moment') return [];

    try {
        const parsed = JSON.parse(moment.content);
        if (!parsed || !Array.isArray(parsed.images)) return [];
        return parsed.images.flatMap((reference, imageIndex) => {
            if (!isSupportedAIDiaryImage(reference)) return [];
            return [{
                moment_id: momentId,
                image_index: imageIndex,
                reference,
                author: moment.author,
                created_at: moment.created_at
            }];
        });
    } catch (_error) {
        return [];
    }
}

async function resolveAIDiaryPreview(candidate) {
    const previewUrl = typeof resolveMediaUrl === 'function'
        ? await resolveMediaUrl(candidate.reference)
        : '';
    if (!previewUrl) return null;
    const safeUrl = typeof sanitizeMediaUrl === 'function'
        ? sanitizeMediaUrl(previewUrl)
        : '';
    return safeUrl ? { ...candidate, previewUrl: safeUrl } : null;
}

function formatAIDiaryImageLabel(candidate) {
    const author = typeof candidate.author === 'string' && candidate.author.trim()
        ? candidate.author.trim()
        : '共享日记';
    const date = new Date(candidate.created_at);
    const dateText = Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    return dateText ? `${author} · ${dateText}` : author;
}

function toggleAIDiaryImage(candidate) {
    if (isChatSending) return;
    const key = getMomentAttachmentKey(candidate.moment_id, candidate.image_index);
    const existingIndex = pendingChatAttachments.findIndex(attachment => attachment.key === key);
    if (existingIndex >= 0) {
        pendingChatAttachments.splice(existingIndex, 1);
        renderPendingChatAttachments();
        return;
    }
    if (pendingChatAttachments.length >= AI_MAX_ATTACHMENTS) {
        notifyAIImageSelection('单次最多选择 9 张图片。');
        return;
    }

    pendingChatAttachments.push({
        id: `diary-${++aiAttachmentSequence}`,
        key,
        source: 'moment',
        moment_id: String(candidate.moment_id),
        image_index: Number(candidate.image_index),
        previewUrl: candidate.previewUrl,
        label: formatAIDiaryImageLabel(candidate),
        revokePreview: false
    });
    renderPendingChatAttachments();
}

function appendAIDiaryImageOption(candidate) {
    const grid = document.getElementById('aiDiaryPickerGrid');
    if (!grid) return;
    const key = getMomentAttachmentKey(candidate.moment_id, candidate.image_index);
    if (aiDiaryPickerRenderedKeys.has(key)) return;
    aiDiaryPickerRenderedKeys.add(key);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-diary-image-option';
    button.dataset.attachmentKey = key;
    button.setAttribute('aria-label', `选择${formatAIDiaryImageLabel(candidate)}的图片`);
    button.addEventListener('click', () => toggleAIDiaryImage(candidate));

    const image = document.createElement('img');
    image.src = candidate.previewUrl;
    image.alt = formatAIDiaryImageLabel(candidate);
    image.loading = 'lazy';

    const meta = document.createElement('span');
    meta.className = 'ai-diary-image-meta';
    meta.textContent = formatAIDiaryImageLabel(candidate);

    const selectedMark = document.createElement('span');
    selectedMark.className = 'ai-diary-selected-mark';
    selectedMark.textContent = '✓';
    selectedMark.hidden = true;

    button.append(image, meta, selectedMark);
    grid.appendChild(button);
}

function syncAIDiaryPickerSelectionState() {
    const selectedKeys = new Set(
        pendingChatAttachments
            .filter(attachment => attachment.source === 'moment')
            .map(attachment => attachment.key)
    );
    const atLimit = pendingChatAttachments.length >= AI_MAX_ATTACHMENTS;
    document.querySelectorAll('.ai-diary-image-option').forEach(button => {
        const selected = selectedKeys.has(button.dataset.attachmentKey);
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = isChatSending || (atLimit && !selected);
        const mark = button.querySelector('.ai-diary-selected-mark');
        if (mark) mark.hidden = !selected;
    });
}

function resetAIDiaryPicker() {
    aiDiaryPickerRequestId += 1;
    aiDiaryPickerOffset = 0;
    aiDiaryPickerHasMore = true;
    isAIDiaryPickerLoading = false;
    aiDiaryPickerRenderedKeys.clear();
    document.getElementById('aiDiaryPickerGrid')?.replaceChildren();
    const status = document.getElementById('aiDiaryPickerStatus');
    if (status) status.textContent = '';
    const loadMore = document.getElementById('aiDiaryLoadMoreBtn');
    if (loadMore) {
        loadMore.hidden = true;
        loadMore.disabled = false;
    }
}

async function loadAIDiaryImages(reset = false) {
    if (!isAuthenticated() || isAIDiaryPickerLoading) return;
    const picker = document.getElementById('aiDiaryPicker');
    if (!picker || picker.hidden) return;
    if (reset) resetAIDiaryPicker();
    if (!aiDiaryPickerHasMore) return;

    const spaceId = String(currentUserProfile?.space_id || '');
    if (!/^[A-Za-z0-9_-]+$/.test(spaceId)) {
        const status = document.getElementById('aiDiaryPickerStatus');
        if (status) status.textContent = '当前账号还没有可用的共享空间。';
        return;
    }

    const requestId = aiDiaryPickerRequestId;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const status = document.getElementById('aiDiaryPickerStatus');
    const loadMore = document.getElementById('aiDiaryLoadMoreBtn');
    isAIDiaryPickerLoading = true;
    if (status) status.textContent = '正在读取共享日记图片…';
    if (loadMore) loadMore.disabled = true;

    try {
        const from = aiDiaryPickerOffset;
        const to = from + AI_DIARY_PAGE_SIZE - 1;
        const { data, error } = await supabaseClient
            .from('moments')
            .select('id::text, author, type, content, created_at')
            .eq('space_id', spaceId)
            .in('type', ['photo', 'moment'])
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to);
        if (error) throw error;
        if (requestId !== aiDiaryPickerRequestId
            || !isCurrentAuthSnapshot(epoch, userId)
            || picker.hidden) {
            return;
        }

        const rows = data || [];
        aiDiaryPickerOffset += rows.length;
        aiDiaryPickerHasMore = rows.length === AI_DIARY_PAGE_SIZE;
        const candidates = rows.flatMap(extractAIDiaryImages);
        const resolved = (await Promise.all(candidates.map(resolveAIDiaryPreview))).filter(Boolean);
        if (requestId !== aiDiaryPickerRequestId
            || !isCurrentAuthSnapshot(epoch, userId)
            || picker.hidden) {
            return;
        }
        resolved.forEach(appendAIDiaryImageOption);

        const renderedCount = document.getElementById('aiDiaryPickerGrid')?.childElementCount || 0;
        if (status) {
            if (renderedCount === 0 && !aiDiaryPickerHasMore) {
                status.textContent = '共享日记里暂时没有可分析的 JPEG、PNG 或 WebP 图片。';
            } else if (resolved.length === 0) {
                status.textContent = '这一页没有可分析的图片，可以继续加载更早的日记。';
            } else {
                status.textContent = `已显示 ${renderedCount} 张图片；选择伴侣图片前请先征得对方同意。`;
            }
        }
        if (loadMore) loadMore.hidden = !aiDiaryPickerHasMore;
    } catch (error) {
        console.error('读取 Agnes 2.0 日记图片失败:', error);
        if (requestId === aiDiaryPickerRequestId && status) {
            status.textContent = '读取日记图片失败，请稍后重试。';
        }
        if (loadMore) loadMore.hidden = false;
    } finally {
        if (requestId === aiDiaryPickerRequestId) {
            isAIDiaryPickerLoading = false;
            if (loadMore) loadMore.disabled = false;
            syncAIDiaryPickerSelectionState();
        }
    }
}

function openAIDiaryPicker() {
    if (isChatSending) return;
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    if (!hasAIServiceConsent()) {
        notifyAIImageSelection('请先在“头像 → 设置 → AI 隐私”中开启 Agnes 2.0。');
        return;
    }
    const picker = document.getElementById('aiDiaryPicker');
    if (!picker) return;
    picker.hidden = false;
    loadAIDiaryImages(true);
}

function closeAIDiaryPicker() {
    const picker = document.getElementById('aiDiaryPicker');
    if (picker) picker.hidden = true;
    aiDiaryPickerRequestId += 1;
    isAIDiaryPickerLoading = false;
}

function loadMoreAIDiaryImages() {
    loadAIDiaryImages(false);
}

function setAIChatComposerBusy(busy) {
    const ids = ['aiChatInput', 'aiChatSendBtn', 'aiLocalImageBtn', 'aiDiaryImageBtn', 'aiLocalImageInput'];
    ids.forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = busy;
    });
    renderPendingChatAttachments();
}

function validatePendingChatAttachments(attachments) {
    if (attachments.length > AI_MAX_ATTACHMENTS) throw createAIError('TOO_MANY_ATTACHMENTS');
    const localBytes = getPendingLocalImageBytes(attachments);
    if (localBytes > AI_MAX_TOTAL_IMAGE_BYTES) throw createAIError('IMAGES_TOO_LARGE');
    attachments.forEach(attachment => {
        if (attachment.source === 'temporary') {
            if (!attachment.file || !AI_IMAGE_EXTENSIONS.has(attachment.file.type)) {
                throw createAIError('UNSUPPORTED_IMAGE_TYPE');
            }
            if (!Number.isFinite(attachment.file.size)
                || attachment.file.size <= 0
                || attachment.file.size > AI_MAX_IMAGE_BYTES) {
                throw createAIError('IMAGE_TOO_LARGE');
            }
            return;
        }
        if (attachment.source !== 'moment'
            || !/^[1-9]\d*$/.test(String(attachment.moment_id))
            || !Number.isInteger(attachment.image_index)
            || attachment.image_index < 0) {
            throw createAIError('INVALID_ATTACHMENT');
        }
    });
}

function getAIUploadContext() {
    const spaceId = String(currentUserProfile?.space_id || '');
    const userId = String(currentAuthUser?.id || '');
    const safeSegment = value => /^[A-Za-z0-9_-]+$/.test(value);
    if (!safeSegment(spaceId) || !safeSegment(userId)) throw createAIError('PROFILE_UNMAPPED');
    return { spaceId, userId };
}

function createAITemporaryObjectPath(file, context) {
    const extension = AI_IMAGE_EXTENSIONS.get(file.type);
    if (!extension) throw createAIError('UNSUPPORTED_IMAGE_TYPE');
    const uniqueId = typeof window.crypto?.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    return `${context.spaceId}/${context.userId}/${uniqueId}.${extension}`;
}

async function buildAIAttachmentPayload(
    attachments,
    uploadedPaths,
    epoch,
    userId,
    uploadGeneration
) {
    const context = getAIUploadContext();
    const payload = [];

    for (const attachment of attachments) {
        if (uploadGeneration !== aiUploadGeneration
            || !isCurrentAuthSnapshot(epoch, userId)
            || !hasAIServiceConsent()) {
            throw createAIError('AUTH_REQUIRED');
        }
        if (attachment.source === 'moment') {
            payload.push({
                source: 'moment',
                moment_id: String(attachment.moment_id),
                image_index: Number(attachment.image_index)
            });
            continue;
        }

        const path = createAITemporaryObjectPath(attachment.file, context);
        uploadedPaths.push(path);
        activeAIUploadPaths.add(path);
        const uploadTask = supabaseClient.storage
            .from(AI_INPUT_BUCKET)
            .upload(path, attachment.file, {
                contentType: attachment.file.type,
                cacheControl: '300',
                upsert: false
            });
        activeAIUploadTasks.add(uploadTask);
        let error;
        try {
            ({ error } = await uploadTask);
        } finally {
            activeAIUploadTasks.delete(uploadTask);
        }
        if (error) throw createAIError('AI_UPLOAD_FAILED', error);
        if (uploadGeneration !== aiUploadGeneration
            || !isCurrentAuthSnapshot(epoch, userId)
            || !hasAIServiceConsent()) {
            throw createAIError('AUTH_REQUIRED');
        }
        payload.push({ source: 'temporary', path });
    }
    return payload;
}

async function removeTemporaryAIInputs(paths) {
    const uniquePaths = [...new Set(Array.isArray(paths) ? paths.filter(Boolean) : [])];
    if (uniquePaths.length === 0 || !supabaseClient) return true;
    try {
        const { error } = await supabaseClient.storage.from(AI_INPUT_BUCKET).remove(uniquePaths);
        if (error) {
            console.warn('临时 AI 图片清理未完成。');
            return false;
        }
        uniquePaths.forEach(path => activeAIUploadPaths.delete(path));
        return true;
    } catch (_error) {
        console.warn('临时 AI 图片清理未完成。');
        return false;
    }
}

async function cleanupActiveAIUploadsBeforeLogout() {
    aiUploadGeneration += 1;
    aiInteractionGeneration += 1;
    activeChatRequestId += 1;
    const uploads = [...activeAIUploadTasks];
    if (uploads.length > 0) {
        let timeoutId;
        await Promise.race([
            Promise.allSettled(uploads),
            new Promise(resolve => {
                timeoutId = setTimeout(resolve, AI_LOGOUT_UPLOAD_DRAIN_TIMEOUT_MS);
            })
        ]);
        clearTimeout(timeoutId);
    }
    return removeTemporaryAIInputs([...activeAIUploadPaths]);
}

async function cleanupStaleAIInputsForCurrentUser() {
    if (!isAuthenticated() || !currentUserProfile?.space_id) return;
    let context;
    try {
        context = getAIUploadContext();
    } catch {
        return;
    }

    const folder = `${context.spaceId}/${context.userId}`;
    const cutoff = Date.now() - AI_STALE_UPLOAD_AGE_MS;
    for (let pass = 0; pass < 5; pass += 1) {
        const { data, error } = await supabaseClient.storage
            .from(AI_INPUT_BUCKET)
            .list(folder, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'created_at', order: 'asc' }
            });
        if (error || !Array.isArray(data) || data.length === 0) return;

        const stalePaths = data
            .filter(item => {
                if (!item?.name || activeAIUploadPaths.has(`${folder}/${item.name}`)) return false;
                const createdAt = new Date(item.created_at || item.updated_at || 0).getTime();
                return Number.isFinite(createdAt) && createdAt > 0 && createdAt < cutoff;
            })
            .map(item => `${folder}/${item.name}`);
        if (stalePaths.length === 0) return;
        if (!await removeTemporaryAIInputs(stalePaths) || data.length < 100) return;
    }
}

async function sendChatMessage() {
    if (isChatSending || !isAuthenticated()) return;
    const input = document.getElementById('aiChatInput');
    const message = input?.value.trim() || '';
    const selectedAttachments = pendingChatAttachments.slice();
    if (!message && selectedAttachments.length === 0) return;
    if (message.length > 500) {
        notifyAIImageSelection('单条消息不能超过 500 个字符。');
        return;
    }
    if (!hasAIServiceConsent()) {
        notifyAIImageSelection('请先在“头像 → 设置 → AI 隐私”中阅读说明并开启 Agnes 2.0。');
        return;
    }

    try {
        validatePendingChatAttachments(selectedAttachments);
    } catch (error) {
        notifyAIImageSelection(getFriendlyAIError(error));
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const interactionGeneration = aiInteractionGeneration;
    const chatRequestId = ++activeChatRequestId;
    const uploadGeneration = aiUploadGeneration;
    const effectiveMessage = message || AI_DEFAULT_IMAGE_PROMPT;
    const currentUserMessage = { role: 'user', content: effectiveMessage };
    const requestMessages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...chatHistory.slice(-6),
        currentUserMessage
    ];
    const uploadedPaths = [];

    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
    closeAIDiaryPicker();
    resetAIDiaryPicker();
    isChatSending = true;
    setAIChatComposerBusy(true);
    appendChatMessage('user', effectiveMessage, selectedAttachments.length);
    const typingMessage = appendChatMessage('ai', 'Agnes 2.0 正在思考…');
    typingMessage?.classList.add('typing');

    try {
        const attachmentPayload = await buildAIAttachmentPayload(
            selectedAttachments,
            uploadedPaths,
            epoch,
            userId,
            uploadGeneration
        );
        const reply = await callAgnesChat(requestMessages, attachmentPayload);
        const isCurrent = isCurrentAuthSnapshot(epoch, userId)
            && aiInteractionGeneration === interactionGeneration
            && hasAIServiceConsent();
        if (!isCurrent || !typingMessage) return;

        typingMessage.textContent = reply;
        typingMessage.classList.remove('typing');
        chatHistory.push(currentUserMessage, { role: 'assistant', content: reply });
        chatHistory = chatHistory.slice(-6);
        clearPendingChatAttachments();
    } catch (error) {
        const isCurrent = isCurrentAuthSnapshot(epoch, userId)
            && aiInteractionGeneration === interactionGeneration;
        if (isCurrent && typingMessage) {
            typingMessage.textContent = getFriendlyAIError(error);
            typingMessage.classList.remove('typing');
            if (message && input && !input.value) input.value = message;
            if (shouldDiscardFailedAIAttachments(error)) clearPendingChatAttachments();
        }
        console.error('Agnes 2.0 对话失败:', normalizeAIErrorCode(error));
    } finally {
        await removeTemporaryAIInputs(uploadedPaths);
        if (chatRequestId === activeChatRequestId) {
            isChatSending = false;
            setAIChatComposerBusy(false);
        }
    }
}

function clearPrivateFeatureState() {
    aiUploadGeneration += 1;
    activeAIUploadPaths.clear();
    activeAIUploadTasks.clear();
    aiInteractionGeneration += 1;
    activeChatRequestId += 1;
    currentAITab = 'topic';
    chatHistory = [];
    isChatSending = false;
    clearPendingChatAttachments();
    closeAIDiaryPicker();
    resetAIDiaryPicker();
    setAIChatComposerBusy(false);
    const chatMessages = document.getElementById('aiChatMessages');
    if (chatMessages) chatMessages.replaceChildren();
    const aiContent = document.getElementById('aiContentArea');
    if (aiContent) aiContent.replaceChildren();
    if (typeof cleanupBlindBox === 'function') cleanupBlindBox();
    window.currentBlindBoxMoment = null;
}

window.addEventListener('pagehide', clearPendingChatAttachments, { passive: true });
