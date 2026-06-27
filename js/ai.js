// ==========================================
// 6. DeepSeek AI 专属助手逻辑
// ==========================================

async function callDeepSeek(systemPrompt, userPrompt) {
    const { data, error } = await supabaseClient.functions.invoke('ai-chat', {
        body: {
            messages: [
                {"role": "system", "content": systemPrompt},
                {"role": "user", "content": userPrompt}
            ],
            temperature: 0.7,
            max_tokens: 800
        }
    });
    
    if (error) {
        throw new Error(`API request failed: ${error.message}`);
    }
    if (data && data.choices && data.choices.length > 0) {
        return data.choices[0].message.content;
    } else {
        throw new Error(data?.error?.message || "AI returned empty data");
    }
}

async function callDeepSeekChat(messages) {
    const { data, error } = await supabaseClient.functions.invoke('ai-chat', {
        body: {
            messages: messages,
            temperature: 0.8,
            max_tokens: 600
        }
    });
    
    if (error) {
        throw new Error(`API request failed: ${error.message}`);
    }
    if (data && data.choices && data.choices.length > 0) {
        return data.choices[0].message.content;
    } else {
        throw new Error(data?.error?.message || "AI returned empty data");
    }
}

let currentAITab = 'topic';

function openAIModal() {
    document.getElementById('aiModal').showModal();
    switchAITab('topic');
}

function closeAIModal() {
    document.getElementById('aiModal').close();
}

function toggleFabMenu() {
    const menu = document.getElementById('fab-menu');
    if (menu.classList.contains('show')) {
        menu.classList.remove('show');
    } else {
        menu.classList.add('show');
    }
}

async function refreshAIContent() {
    const refreshBtn = document.getElementById('aiRefreshBtn');
    if (refreshBtn.classList.contains('spinning')) return;
    refreshBtn.classList.add('spinning');
    try {
        await switchAITab(currentAITab, true);
    } finally {
        refreshBtn.classList.remove('spinning');
    }
}

async function switchAITab(tabName, forceRefresh = false) {
    currentAITab = tabName;
    // Update tab style
    document.querySelectorAll('.ai-tab').forEach(btn => btn.classList.remove('active'));
    const tabBtn = Array.from(document.querySelectorAll('.ai-tab')).find(b => b.getAttribute('onclick').includes(tabName));
    if (tabBtn) tabBtn.classList.add('active');

    const contentArea = document.getElementById('aiContentArea');
    contentArea.innerHTML = '<div class="ai-loading">思考中，请稍候... ✨</div>';

    try {
        // Only check cache if not force refreshing
        if (!forceRefresh) {
            let validTimeStr = new Date();
            if (tabName === 'summary') {
                validTimeStr.setDate(validTimeStr.getDate() - 7); 
            } else {
                validTimeStr.setHours(0,0,0,0); 
            }
            
            const { data: existingData, error: qErr } = await supabaseClient
                .from('ai_content')
                .select('*')
                .eq('type', tabName)
                .gte('created_at', validTimeStr.toISOString())
                .order('created_at', { ascending: false })
                .limit(1);

            if (!qErr && existingData && existingData.length > 0) {
                contentArea.innerHTML = escapeHtml(existingData[0].content);
                return;
            }
        }

        let systemPrompt = "";
        let userPrompt = "";
        let generatedText = "";

        if (tabName === 'topic') {
            systemPrompt = "你是一个温暖、可爱的情感小助手。你的任务是给一对情侣（小蛇和小奚）提供每天的专属互动话题。话题要有趣、能增进感情、或者带来回忆。";
            userPrompt = "请生成今天的每日话题，直接输出话题本身，语言要亲切、带点俏皮，200字以内。";
            generatedText = await callDeepSeek(systemPrompt, userPrompt);
        } 
        else if (tabName === 'anniversary') {
            const now = new Date();
            const currentYear = now.getFullYear();
            let annivDate = new Date(currentYear, 4, 23);
            if (now > annivDate) {
                annivDate = new Date(currentYear + 1, 4, 23);
            }
            const diffDays = Math.ceil((annivDate - now) / (1000 * 60 * 60 * 24));
            
            if (diffDays <= 7) {
                systemPrompt = "你是一个深情的爱情文案专家。这对情侣（小蛇和小奚）即将在" + diffDays + "天后迎来他们的相爱纪念日。";
                userPrompt = "请为他们写一段充满期待和爱意的纪念日倒计时文案。要求：感情真挚，提到还有几天就是纪念日了，300字以内。";
                generatedText = await callDeepSeek(systemPrompt, userPrompt);
            } else {
                contentArea.innerHTML = `距离下一个纪念日（5月23日）还有 ${diffDays} 天，等到只剩7天的时候，我再来给你们写专属情话吧~ 💖`;
                return; 
            }
        } 
        else if (tabName === 'summary') {
            const { data: textData } = await supabaseClient
                .from('moments')
                .select('author, content, created_at')
                .eq('type', 'text')
                .order('created_at', { ascending: false })
                .limit(10);
            
            if (!textData || textData.length === 0) {
                contentArea.innerHTML = "目前还没有太多文字记录呢，多写点日记，下周我来帮你们做故事总结！";
                return;
            }
            
            let storyLog = textData.reverse().map(m => {
                const shortText = m.content.length > 100 ? m.content.substring(0, 100) + '...' : m.content;
                return `${m.author} 说：${shortText}`;
            }).join('\n');
            systemPrompt = "你是一个感情故事的记录员。请根据情侣（小蛇和小奚）最近的文字日记，以第一人称（作为他们回忆的守护者）总结他们近期的感情状态和生活片段。";
            userPrompt = "日记如下：\n" + storyLog + "\n\n请写一篇优美、温情的“我们的近期故事总结”（400字以内）。";
            generatedText = await callDeepSeek(systemPrompt, userPrompt);
        }

        contentArea.innerHTML = escapeHtml(generatedText);

        // Only cache successful results
        if (generatedText) {
            await supabaseClient.from('ai_content').insert([{ type: tabName, content: generatedText }]);
            
            const retainDate = new Date();
            retainDate.setDate(retainDate.getDate() - 7);
            await supabaseClient
                .from('ai_content')
                .delete()
                .neq('type', 'summary')
                .lt('created_at', retainDate.toISOString());
            
            const retainSummaryDate = new Date();
            retainSummaryDate.setDate(retainSummaryDate.getDate() - 30);
            await supabaseClient
                .from('ai_content')
                .delete()
                .eq('type', 'summary')
                .lt('created_at', retainSummaryDate.toISOString());
        }

    } catch (err) {
        console.error("AI 模块出错:", err);
        contentArea.innerHTML = '<div style="text-align:center;">' +
            '<div style="margin-bottom:12px;">糟糕，脑电波连接失败啦 🥺</div>' +
            '<div style="font-size:0.82em; color:var(--text-muted); margin-bottom:16px;">点击上方 🔄 按钮重新尝试</div>' +
            '</div>';
    }
}

// ==========================================
// AI Chat Dialog (no persistent storage)
// ==========================================
let chatHistory = [];
let isChatSending = false;
const CHAT_SYSTEM_PROMPT = "你是小蛇和小奚的专属情感小助理，语气温暖、俏皮、可爱。你的任务是帮助这对情侣聊天解闷、提供恋爱建议、推荐约会点子、帮忙化解小矛盾，或者只是陪他们聊聊天。回答要简洁温馨，每次不超过200字。可以适当使用emoji。";

function openAIChatModal() {
    document.getElementById('aiChatOverlay').showModal();
    document.getElementById('aiChatInput').focus();
}

function closeAIChatModal() {
    document.getElementById('aiChatOverlay').close();
}

function handleChatKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChatMessage();
    }
}

function appendChatMessage(role, text) {
    const container = document.getElementById('aiChatMessages');
    const welcome = container.querySelector('.ai-chat-welcome');
    if (welcome) welcome.remove();

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg ' + (role === 'user' ? 'user' : 'ai');
    msgDiv.textContent = text;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
}

async function sendChatMessage() {
    if (isChatSending) return;
    const input = document.getElementById('aiChatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    input.style.height = 'auto';
    isChatSending = true;
    document.getElementById('aiChatSendBtn').disabled = true;

    appendChatMessage('user', text);
    chatHistory.push({ role: 'user', content: text });

    // Keep only last 6 messages (3 turns) to avoid token overflow
    const recentHistory = chatHistory.slice(-6);

    const typingMsg = appendChatMessage('ai', '思考中...');
    typingMsg.classList.add('typing');

    try {
        const messages = [
            { role: 'system', content: CHAT_SYSTEM_PROMPT },
            ...recentHistory
        ];
        const reply = await callDeepSeekChat(messages);

        typingMsg.textContent = reply;
        typingMsg.classList.remove('typing');

        chatHistory.push({ role: 'assistant', content: reply });
    } catch (err) {
        console.error('Chat AI error:', err);
        typingMsg.textContent = '哎呀，我走神了...再说一次吧~ 🥺';
        typingMsg.classList.remove('typing');
    } finally {
        isChatSending = false;
        document.getElementById('aiChatSendBtn').disabled = false;
        const container = document.getElementById('aiChatMessages');
        container.scrollTop = container.scrollHeight;
    }
}
