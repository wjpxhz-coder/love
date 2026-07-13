// ==========================================
// 心情打卡
// ==========================================
const MOOD_EMOJIS = ['', '😢', '😕', '😊', '😄', '🥰'];
const MOOD_COLORS = ['', '#e8c0c0', '#d4b8d4', '#b8d4c0', '#b8cce8', '#e8b8d0'];
const MOOD_TIME_ZONE = 'Asia/Shanghai';
let selectedMoodScore = 0;

function getAppDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: MOOD_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(dateKey, days) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    return shifted.toISOString().slice(0, 10);
}

function openMoodModal() {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }

    selectedMoodScore = 0;
    document.querySelectorAll('.mood-emoji-btn').forEach(button => {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
    });
    document.getElementById('moodNote').value = '';
    document.getElementById('moodModalMsg').textContent = '';
    document.getElementById('moodModal').showModal();
}

function closeMoodModal() {
    const modal = document.getElementById('moodModal');
    if (modal?.open) modal.close();
}

function selectMood(score) {
    const normalizedScore = Number(score);
    if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore > 5) return;

    selectedMoodScore = normalizedScore;
    document.querySelectorAll('.mood-emoji-btn').forEach(button => {
        const selected = Number(button.dataset.score) === normalizedScore;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
}

async function submitMood() {
    const messageElement = document.getElementById('moodModalMsg');
    if (!isAuthenticated()) {
        closeMoodModal();
        openLoginModal();
        return;
    }
    if (!selectedMoodScore) {
        messageElement.textContent = '请先选择今天的心情哦！';
        return;
    }

    const note = document.getElementById('moodNote').value.trim();
    if (note.length > 300) {
        messageElement.textContent = '心情记录不能超过 300 个字符';
        return;
    }

    const submitButton = document.querySelector('#moodModal .modal-btns button:last-child');
    const originalText = submitButton?.textContent || '记录';
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = '记录中…';
    }

    try {
        const { error } = await supabaseClient.from('moods').upsert([{
            date: getAppDateKey(),
            score: selectedMoodScore,
            note: note || null
        }], { onConflict: 'user_id,date' });
        if (error) throw error;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        closeMoodModal();
        await loadMoods();
    } catch (error) {
        console.error('保存心情失败:', error);
        messageElement.textContent = '保存失败，请稍后重试。';
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }
    }
}

function renderMoodHeatmap(heatmap, dates, entriesByDate) {
    const fragment = document.createDocumentFragment();
    dates.forEach(date => {
        const entries = entriesByDate[date] || [];
        const dot = document.createElement('div');
        if (!entries.length) {
            dot.className = 'mood-empty-dot';
            dot.title = date;
            dot.setAttribute('aria-label', `${date} 没有心情记录`);
            fragment.appendChild(dot);
            return;
        }

        const total = entries.reduce((sum, entry) => sum + Number(entry.score || 0), 0);
        const average = Math.max(1, Math.min(5, Math.round(total / entries.length)));
        const labels = entries.map(entry => {
            const author = entry.author || '成员';
            const emoji = MOOD_EMOJIS[Number(entry.score)] || '';
            return `${author}${emoji}${entry.note ? ` ${entry.note}` : ''}`;
        }).join(' / ');

        dot.className = 'mood-dot';
        dot.style.backgroundColor = MOOD_COLORS[average];
        dot.textContent = MOOD_EMOJIS[average];
        dot.title = `${date} ${labels}`;
        dot.setAttribute('aria-label', `${date}：${labels}`);
        fragment.appendChild(dot);
    });

    heatmap.replaceChildren(fragment);
}

async function loadMoods() {
    const heatmap = document.getElementById('mood-heatmap');
    if (!heatmap) return;
    if (!isAuthenticated()) {
        heatmap.replaceChildren();
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const today = getAppDateKey();
    const dates = Array.from({ length: 28 }, (_, index) => shiftDateKey(today, index - 27));

    const { data, error } = await supabaseClient
        .from('moods')
        .select('date, score, author, note')
        .gte('date', dates[0])
        .lte('date', dates[dates.length - 1])
        .order('date', { ascending: true });

    if (!isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('加载心情日历失败:', error);
        heatmap.replaceChildren();
        return;
    }

    const entriesByDate = {};
    (data || []).forEach(entry => {
        if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
        entriesByDate[entry.date].push(entry);
    });
    renderMoodHeatmap(heatmap, dates, entriesByDate);
}
