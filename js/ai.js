// ==========================================
// AI 专属助手
// ==========================================
const AI_TABS = new Set(['topic', 'anniversary', 'summary']);
const CHAT_SYSTEM_PROMPT = '你是小蛇和小奚的专属情感小助理，语气温暖、俏皮、可爱。帮助他们聊天解闷、提供恋爱建议、推荐约会点子或化解小矛盾。回答简洁温馨，每次不超过200字。';
const AI_SERVICE_CONSENT_PREFIX = 'ai_service_consent_';
let currentAITab = 'topic';
let chatHistory = [];
let isChatSending = false;

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

    if (enabled) localStorage.setItem(key, 'granted');
    else {
        localStorage.removeItem(key);
        chatHistory = [];
    }
    syncAIPrivacySetting();
    if (typeof showToast === 'function') {
        showToast(enabled ? 'AI 服务已开启，可随时在设置中关闭。' : 'AI 服务已关闭，不会再向 DeepSeek 发送内容。');
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

async function invokeAI(messages) {
    assertAIAuthenticated();
    assertAIConsent();
    const { data, error } = await supabaseClient.functions.invoke('ai-chat', {
        body: { messages }
    });
    if (error) throw new Error('AI_REQUEST_FAILED');
    return readAIResponse(data);
}

function callDeepSeek(systemPrompt, userPrompt) {
    return invokeAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ]);
}

function callDeepSeekChat(messages) {
    return invokeAI(messages);
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
    const { data, error } = await supabaseClient
        .from('moments')
        .select('author, user_id, type, content, created_at')
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
        .slice(0, 4000);
}

async function getCachedAIContent(tabName) {
    const validSince = new Date();
    if (tabName === 'summary') validSince.setDate(validSince.getDate() - 7);
    else validSince.setHours(0, 0, 0, 0);

    let query = supabaseClient
        .from('ai_content')
        .select('content, created_at')
        .eq('type', tabName)
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
        .insert([{ type: tabName, content }]);
    if (error) console.error('缓存 AI 内容失败:', error);
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
    const stillCurrent = () => isCurrentAuthSnapshot(epoch, userId) && currentAITab === tabName;

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
            generatedText = await callDeepSeek(
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
            generatedText = await callDeepSeek(
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
            generatedText = await callDeepSeek(
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
        console.error('AI 模块出错:', error);
        setAIContent('脑电波连接失败啦 🥺 请稍后点击刷新重试。', 'error');
    }
}

// ==========================================
// AI 对话（仅保存在当前页面内）
// ==========================================
function openAIChatModal() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    document.getElementById('aiChatOverlay')?.showModal();
    document.getElementById('aiChatInput')?.focus();
}

function closeAIChatModal() {
    const modal = document.getElementById('aiChatOverlay');
    if (modal?.open) modal.close();
}

function handleChatKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function appendChatMessage(role, message) {
    const container = document.getElementById('aiChatMessages');
    if (!container) return null;
    container.querySelector('.ai-chat-welcome')?.remove();

    const messageElement = document.createElement('div');
    messageElement.className = `chat-msg ${role === 'user' ? 'user' : 'ai'}`;
    messageElement.textContent = message;
    container.appendChild(messageElement);
    container.scrollTop = container.scrollHeight;
    return messageElement;
}

async function sendChatMessage() {
    if (isChatSending || !isAuthenticated()) return;
    const input = document.getElementById('aiChatInput');
    const sendButton = document.getElementById('aiChatSendBtn');
    const message = input?.value.trim() || '';
    if (!message) return;
    if (message.length > 500) {
        if (typeof showToast === 'function') showToast('单条消息不能超过 500 个字符');
        return;
    }
    if (!hasAIServiceConsent()) {
        if (typeof showToast === 'function') {
            showToast('请先在“头像 → 设置 → AI 隐私”中阅读说明并开启 AI。', 5000);
        }
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    input.value = '';
    input.style.height = 'auto';
    isChatSending = true;
    if (sendButton) sendButton.disabled = true;

    appendChatMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    chatHistory = chatHistory.slice(-6);
    const typingMessage = appendChatMessage('ai', '思考中...');
    typingMessage?.classList.add('typing');

    try {
        const reply = await callDeepSeekChat([
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...chatHistory
        ]);
        if (!isCurrentAuthSnapshot(epoch, userId) || !typingMessage) return;
        typingMessage.textContent = reply;
        typingMessage.classList.remove('typing');
        chatHistory.push({ role: 'assistant', content: reply });
        chatHistory = chatHistory.slice(-6);
    } catch (error) {
        if (isCurrentAuthSnapshot(epoch, userId) && typingMessage) {
            typingMessage.textContent = '哎呀，我走神了…稍后再试一次吧~ 🥺';
            typingMessage.classList.remove('typing');
        }
        console.error('AI 对话失败:', error);
    } finally {
        isChatSending = false;
        if (sendButton) sendButton.disabled = false;
    }
}

function clearPrivateFeatureState() {
    currentAITab = 'topic';
    chatHistory = [];
    isChatSending = false;
    const chatMessages = document.getElementById('aiChatMessages');
    if (chatMessages) chatMessages.replaceChildren();
    const aiContent = document.getElementById('aiContentArea');
    if (aiContent) aiContent.replaceChildren();
    if (typeof cleanupBlindBox === 'function') cleanupBlindBox();
    window.currentBlindBoxMoment = null;
}
