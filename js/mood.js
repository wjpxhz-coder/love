// ==========================================
// 心情打卡
// ==========================================
const MOOD_EMOJIS = ['', '😢', '😕', '😊', '😄', '🥰'];
const MOOD_COLORS = ['', '#e8c0c0', '#d4b8d4', '#b8d4c0', '#b8cce8', '#e8b8d0'];
let selectedMoodScore = 0;

function openMoodModal() {
    selectedMoodScore = 0;
    document.querySelectorAll('.mood-emoji-btn').forEach(b => b.classList.remove('selected'));
    document.getElementById('moodNote').value = '';
    document.getElementById('moodModalMsg').innerText = '';
    document.getElementById('moodModal').showModal();
}

function closeMoodModal() {
    document.getElementById('moodModal').close();
}

function selectMood(score) {
    selectedMoodScore = score;
    document.querySelectorAll('.mood-emoji-btn').forEach(b => {
        b.classList.toggle('selected', parseInt(b.dataset.score) === score);
    });
}

async function submitMood() {
    const msgEl = document.getElementById('moodModalMsg');
    if (!selectedMoodScore) { msgEl.innerText = '请先选择今天的心情哦！'; return; }

    const note = document.getElementById('moodNote').value.trim();
    const today = new Date().toISOString().slice(0, 10);

    const { error } = await supabaseClient.from('moods').insert([{
        date: today,
        author: currentAuthor,
        score: selectedMoodScore,
        note: note || null
    }]);

    if (error) { msgEl.innerText = '保存失败: ' + error.message; return; }
    closeMoodModal();
    loadMoods();
}

async function loadMoods() {
    const heatmap = document.getElementById('mood-heatmap');
    const days = 28;
    const today = new Date();

    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
    }

    const from = dates[0];
    const { data, error } = await supabaseClient.from('moods')
        .select('date, score, author, note')
        .gte('date', from)
        .order('date', { ascending: true });

    if (error) return;

    const map = {};
    (data || []).forEach(m => {
        if (!map[m.date]) map[m.date] = [];
        map[m.date].push(m);
    });

    heatmap.innerHTML = dates.map(d => {
        const entries = map[d] || [];
        if (!entries.length) return `<div class="mood-empty-dot" title="${d}"></div>`;
        const avg = Math.round(entries.reduce((s, e) => s + e.score, 0) / entries.length);
        const labels = entries.map(e => `${e.author || ''}${MOOD_EMOJIS[e.score]}${e.note ? ' ' + e.note : ''}`).join(' / ');
        return `<div class="mood-dot" style="background:${MOOD_COLORS[avg]};" title="${d} ${labels}">${MOOD_EMOJIS[avg]}</div>`;
    }).join('');
}
