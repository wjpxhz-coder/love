// ==========================================
// 心情打卡与月历
// ==========================================
const MOOD_EMOJIS = ['', '😢', '😕', '😊', '😄', '🥰'];
const MOOD_TIME_ZONE = 'Asia/Shanghai';
const MOOD_ENTRY_FIELDS = 'id, user_id, date, score, author, note, created_at, updated_at';

let selectedMoodScore = 0;
let editingMoodId = null;
let isMoodSaving = false;
let currentMoodMonthKey = '';
let moodEntriesByDate = {};
let moodLoadRequestId = 0;
let activeMoodDetailDate = '';
let moodDetailReturnDate = '';
let todayOwnMoodCount = 0;

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

function getCurrentMoodMonthKey() {
    return getAppDateKey().slice(0, 7);
}

function normalizeMoodMonthKey(monthKey) {
    return /^\d{4}-\d{2}$/.test(monthKey || '') ? monthKey : getCurrentMoodMonthKey();
}

function shiftMoodMonth(monthKey, offset) {
    const [year, month] = normalizeMoodMonthKey(monthKey).split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getMoodMonthBounds(monthKey) {
    const normalized = normalizeMoodMonthKey(monthKey);
    const [year, month] = normalized.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
        year,
        month,
        daysInMonth,
        firstDate: `${normalized}-01`,
        lastDate: `${normalized}-${String(daysInMonth).padStart(2, '0')}`,
        mondayOffset: (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7
    };
}

function formatMoodMonthTitle(monthKey) {
    const [year, month] = normalizeMoodMonthKey(monthKey).split('-');
    return `${year} 年 ${Number(month)} 月`;
}

function updateMoodMonthPicker(monthKey) {
    const yearPicker = document.getElementById('mood-calendar-year');
    const monthPicker = document.getElementById('mood-calendar-month');
    if (!yearPicker || !monthPicker) return false;

    const [selectedYear, selectedMonth] = normalizeMoodMonthKey(monthKey).split('-');
    const currentYear = Number(getCurrentMoodMonthKey().slice(0, 4));
    const firstYear = 2000;
    if (yearPicker.options.length !== currentYear - firstYear + 1) {
        const options = document.createDocumentFragment();
        for (let year = currentYear; year >= firstYear; year -= 1) {
            const option = document.createElement('option');
            option.value = String(year);
            option.textContent = `${year} 年`;
            options.appendChild(option);
        }
        yearPicker.replaceChildren(options);
    }
    yearPicker.value = selectedYear;
    monthPicker.value = selectedMonth;
    return true;
}

function formatMoodDateTitle(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return `${year} 年 ${month} 月 ${day} 日`;
}

function moodEntryTimestamp(entry) {
    const value = new Date(entry.created_at || 0).getTime();
    return Number.isFinite(value) ? value : 0;
}

function compareMoodEntries(left, right) {
    const timeDifference = moodEntryTimestamp(left) - moodEntryTimestamp(right);
    if (timeDifference) return timeDifference;
    return String(left.id).localeCompare(String(right.id), undefined, { numeric: true });
}

function normalizeMoodNotePreview(note) {
    return typeof note === 'string' ? note.replace(/\s+/g, ' ').trim() : '';
}

function getLatestMoodNotePreview(entries) {
    let latestPreview = null;
    entries.forEach(entry => {
        const note = normalizeMoodNotePreview(entry.note);
        if (!note) return;
        if (!latestPreview || compareMoodEntries(latestPreview.entry, entry) < 0) {
            latestPreview = { entry, note };
        }
    });
    return latestPreview;
}

function getMoodEntryById(entryId) {
    const targetId = String(entryId);
    for (const entries of Object.values(moodEntriesByDate)) {
        const match = entries.find(entry => String(entry.id) === targetId);
        if (match) return match;
    }
    return null;
}

function resetMoodComposer(entry = null) {
    selectedMoodScore = entry ? Number(entry.score) : 0;
    document.querySelectorAll('.mood-emoji-btn').forEach(button => {
        const selected = Number(button.dataset.score) === selectedMoodScore;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    document.getElementById('moodNote').value = entry?.note || '';
    document.getElementById('moodModalMsg').textContent = '';
}

function openMoodModal(entryId = null) {
    const target = entryId === null
        ? '/mood/check-in'
        : `/mood/edit/${encodeURIComponent(String(entryId))}`;
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

async function loadMoodEntryForRoute(entryId) {
    if (!isAuthenticated()) return null;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    let query = supabaseClient
        .from('moods')
        .select(MOOD_ENTRY_FIELDS)
        .eq('id', entryId)
        .eq('user_id', userId);
    if (currentUserProfile?.space_id) query = query.eq('space_id', currentUserProfile.space_id);
    const { data, error } = await query.maybeSingle();
    if (!isCurrentAuthSnapshot(epoch, userId) || error || !data) return null;
    const entries = moodEntriesByDate[data.date] || [];
    if (!entries.some(entry => String(entry.id) === String(data.id))) {
        moodEntriesByDate[data.date] = [...entries, data].sort(compareMoodEntries);
    }
    return data;
}

async function enterMoodPage(route) {
    if (!isAuthenticated()) return;
    const entryId = route?.id === 'mood' && route?.params?.id
        ? route.params.id
        : null;
    let entry = entryId === null ? null : getMoodEntryById(entryId);
    if (entryId !== null && !entry) entry = await loadMoodEntryForRoute(entryId);
    const currentMoodRoute = typeof getCurrentAppRoute === 'function' ? getCurrentAppRoute() : null;
    if (currentMoodRoute && currentMoodRoute.fullPath !== route?.fullPath) return;
    if (entryId !== null && (!entry || entry.user_id !== currentAuthUser.id)) {
        if (typeof showToast === 'function') showToast('只能编辑自己的心情记录。');
        if (typeof appBack === 'function') appBack('/');
        return;
    }

    editingMoodId = entry ? entry.id : null;
    const title = document.getElementById('mood-modal-title');
    const submitButton = document.getElementById('mood-submit-button');
    if (title) title.textContent = entry ? `编辑 ${formatMoodDateTitle(entry.date)} 的心情` : '今日心情打卡 🌈';
    if (submitButton) submitButton.textContent = entry ? '保存修改' : '记录';
    resetMoodComposer(entry);
}

function closeMoodModal() {
    if (isMoodSaving) return;
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function leaveMoodPage() {
    editingMoodId = null;
    moodDetailReturnDate = '';
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
    if (isMoodSaving) return;
    if (!selectedMoodScore) {
        messageElement.textContent = '请先选择今天的心情哦！';
        return;
    }

    const note = document.getElementById('moodNote').value.trim();
    if (note.length > 300) {
        messageElement.textContent = '心情记录不能超过 300 个字符';
        return;
    }

    const submitButton = document.getElementById('mood-submit-button');
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const entryBeingEdited = editingMoodId === null ? null : getMoodEntryById(editingMoodId);
    const returnDate = entryBeingEdited?.date || '';
    isMoodSaving = true;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = entryBeingEdited ? '保存中…' : '记录中…';
    }

    try {
        let result;
        if (entryBeingEdited) {
            result = await supabaseClient
                .from('moods')
                .update({ score: selectedMoodScore, note: note || null })
                .eq('id', entryBeingEdited.id)
                .eq('user_id', userId)
                .select(MOOD_ENTRY_FIELDS)
                .single();
        } else {
            result = await supabaseClient
                .from('moods')
                .insert([{
                    date: getAppDateKey(),
                    score: selectedMoodScore,
                    note: note || null
                }])
                .select(MOOD_ENTRY_FIELDS)
                .single();
        }
        if (result.error) throw result.error;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        if (!entryBeingEdited) todayOwnMoodCount += 1;

        editingMoodId = null;
        await loadMoods(currentMoodMonthKey || getCurrentMoodMonthKey());
        if (!isCurrentAuthSnapshot(epoch, userId)) return;
        if (typeof appBack === 'function') {
            const fallback = returnDate
                ? `/mood/day/${encodeURIComponent(returnDate)}`
                : '/';
            appBack(fallback, { force: true });
        } else {
            window.location.hash = returnDate
                ? `#/mood/day/${encodeURIComponent(returnDate)}`
                : '#/';
        }
        if (typeof refreshMoodReminderState === 'function') await refreshMoodReminderState();
    } catch (error) {
        console.error('保存心情失败:', error);
        messageElement.textContent = error?.code === '23505'
            ? '数据库仍限制每天一条记录，请先执行最新迁移。'
            : '保存失败，请稍后重试。';
    } finally {
        isMoodSaving = false;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = editingMoodId === null ? '记录' : '保存修改';
        }
    }
}

function createMoodCalendarCell(dateKey, dayNumber, entries) {
    const today = getAppDateKey();
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'mood-calendar-day';
    cell.setAttribute('role', 'gridcell');
    if (dateKey === today) cell.classList.add('today');
    if (entries.length) cell.classList.add('has-entries');

    const day = document.createElement('span');
    day.className = 'mood-calendar-day-number';
    day.textContent = String(dayNumber);
    cell.appendChild(day);

    if (entries.length) {
        const latestByMember = new Map();
        entries.forEach(entry => latestByMember.set(entry.user_id || entry.author, entry));
        const notePreview = getLatestMoodNotePreview(entries);
        const previews = document.createElement('span');
        previews.className = 'mood-calendar-previews';
        latestByMember.forEach(entry => {
            const preview = document.createElement('span');
            preview.className = 'mood-calendar-preview';
            preview.textContent = MOOD_EMOJIS[Number(entry.score)] || '•';
            preview.title = `${entry.author || '成员'}：${MOOD_EMOJIS[Number(entry.score)] || ''}`;
            previews.appendChild(preview);
        });
        cell.appendChild(previews);

        if (notePreview) {
            const note = document.createElement('span');
            note.className = 'mood-calendar-note-preview';
            note.textContent = notePreview.note;
            note.title = `${notePreview.entry.author || '成员'}：${notePreview.note}`;
            cell.appendChild(note);
        }

        if (entries.length > 1) {
            const count = document.createElement('span');
            count.className = 'mood-entry-count';
            count.textContent = `${entries.length} 条`;
            cell.appendChild(count);
        }
        const labels = entries.map(entry => `${entry.author || '成员'}${MOOD_EMOJIS[Number(entry.score)] || ''}`).join('、');
        const noteLabel = notePreview
            ? `；最新内容，${notePreview.entry.author || '成员'}：${notePreview.note}`
            : '';
        cell.setAttribute('aria-label', `${formatMoodDateTitle(dateKey)}，${entries.length} 条心情记录：${labels}${noteLabel}，点击查看完整记录`);
        cell.addEventListener('click', () => openMoodDayModal(dateKey));
    } else if (dateKey === today) {
        cell.setAttribute('aria-label', `${formatMoodDateTitle(dateKey)}，尚未打卡，点击记录`);
        cell.addEventListener('click', () => openMoodModal());
    } else {
        cell.setAttribute('aria-label', `${formatMoodDateTitle(dateKey)}，没有心情记录`);
        cell.disabled = true;
    }
    return cell;
}

function renderMoodCalendar(monthKey, entriesByDate) {
    const heatmap = document.getElementById('mood-heatmap');
    const nextButton = document.getElementById('mood-calendar-next');
    if (!heatmap || !updateMoodMonthPicker(monthKey)) return;

    const bounds = getMoodMonthBounds(monthKey);
    const currentMonth = getCurrentMoodMonthKey();
    if (nextButton) nextButton.disabled = monthKey >= currentMonth;

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < bounds.mondayOffset; index += 1) {
        const spacer = document.createElement('span');
        spacer.className = 'mood-calendar-spacer';
        spacer.setAttribute('aria-hidden', 'true');
        fragment.appendChild(spacer);
    }

    for (let day = 1; day <= bounds.daysInMonth; day += 1) {
        const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`;
        fragment.appendChild(createMoodCalendarCell(dateKey, day, entriesByDate[dateKey] || []));
    }
    heatmap.replaceChildren(fragment);
    updateMoodCheckinPrompt();
}

function updateMoodCheckinPrompt() {
    const label = document.getElementById('mood-checkin-label');
    const button = document.getElementById('mood-checkin-button');
    if (label) label.textContent = todayOwnMoodCount ? `今天已记录 ${todayOwnMoodCount} 次` : '今天心情怎么样？';
    if (button) button.textContent = todayOwnMoodCount ? '✨ 再记一条' : '✨ 打卡心情';
}

async function loadMoods(monthKey = currentMoodMonthKey || getCurrentMoodMonthKey()) {
    const heatmap = document.getElementById('mood-heatmap');
    const status = document.getElementById('mood-calendar-status');
    if (!heatmap) return;
    if (!isAuthenticated()) {
        heatmap.replaceChildren();
        return;
    }

    const requestedMonth = normalizeMoodMonthKey(monthKey);
    const currentMonth = getCurrentMoodMonthKey();
    currentMoodMonthKey = requestedMonth > currentMonth ? currentMonth : requestedMonth;
    const bounds = getMoodMonthBounds(currentMoodMonthKey);
    const requestId = ++moodLoadRequestId;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    if (status) status.textContent = '正在加载本月心情…';

    let query = supabaseClient
        .from('moods')
        .select(MOOD_ENTRY_FIELDS)
        .gte('date', bounds.firstDate)
        .lte('date', bounds.lastDate)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });
    if (currentUserProfile?.space_id) query = query.eq('space_id', currentUserProfile.space_id);
    const { data, error } = await query;

    if (requestId !== moodLoadRequestId || !isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('加载心情月历失败:', error);
        moodEntriesByDate = {};
        renderMoodCalendar(currentMoodMonthKey, moodEntriesByDate);
        if (status) status.textContent = '本月心情加载失败，请稍后重试。';
        return;
    }

    const entriesByDate = {};
    (data || []).forEach(entry => {
        if (!entriesByDate[entry.date]) entriesByDate[entry.date] = [];
        entriesByDate[entry.date].push(entry);
    });
    Object.values(entriesByDate).forEach(entries => entries.sort(compareMoodEntries));
    moodEntriesByDate = entriesByDate;
    if (currentMoodMonthKey === getCurrentMoodMonthKey()) {
        todayOwnMoodCount = (entriesByDate[getAppDateKey()] || [])
            .filter(entry => entry.user_id === userId).length;
    }
    renderMoodCalendar(currentMoodMonthKey, moodEntriesByDate);
    if (status) status.textContent = data?.length ? '' : '这个月还没有心情记录。';
}

function changeMoodMonth(offset) {
    const nextMonth = shiftMoodMonth(currentMoodMonthKey || getCurrentMoodMonthKey(), Number(offset) || 0);
    if (nextMonth > getCurrentMoodMonthKey()) return;
    loadMoods(nextMonth);
}

function selectMoodMonth(monthKey) {
    const selectedMonth = normalizeMoodMonthKey(monthKey);
    if (selectedMonth > getCurrentMoodMonthKey()) {
        goToCurrentMoodMonth();
        return;
    }
    loadMoods(selectedMonth);
}

function selectMoodMonthFromPicker() {
    const year = document.getElementById('mood-calendar-year')?.value;
    const month = document.getElementById('mood-calendar-month')?.value;
    selectMoodMonth(`${year}-${month}`);
}

function goToCurrentMoodMonth() {
    loadMoods(getCurrentMoodMonthKey());
}

function formatMoodEntryTime(entry) {
    const date = new Date(entry.created_at);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: MOOD_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(date);
}

function createMoodDayEntry(entry) {
    const card = document.createElement('article');
    card.className = `mood-day-entry${entry.user_id === currentAuthUser?.id ? ' own' : ''}`;

    const header = document.createElement('div');
    header.className = 'mood-day-entry-header';
    const identity = document.createElement('strong');
    identity.textContent = `${entry.author || '成员'} ${MOOD_EMOJIS[Number(entry.score)] || ''}`;
    const time = document.createElement('time');
    time.dateTime = entry.created_at || '';
    time.textContent = formatMoodEntryTime(entry);
    header.append(identity, time);
    card.appendChild(header);

    const note = document.createElement('p');
    note.className = `mood-day-entry-note${entry.note ? '' : ' empty'}`;
    note.textContent = entry.note || '没有留下文字';
    card.appendChild(note);

    if (entry.user_id === currentAuthUser?.id) {
        const actions = document.createElement('div');
        actions.className = 'mood-day-entry-actions';
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = '编辑';
        editButton.addEventListener('click', () => editMoodEntry(entry.id));
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'danger';
        deleteButton.textContent = '删除';
        deleteButton.addEventListener('click', () => deleteMoodEntry(entry.id));
        actions.append(editButton, deleteButton);
        card.appendChild(actions);
    }
    return card;
}

function openMoodDayModal(dateKey) {
    if (!dateKey) return;
    const target = `/mood/day/${encodeURIComponent(String(dateKey))}`;
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

async function enterMoodDayPage(route) {
    const dateKey = String(route?.params?.date || '');
    let entries = moodEntriesByDate[dateKey] || [];
    if (!entries.length && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && isAuthenticated()) {
        await loadMoods(dateKey.slice(0, 7));
        const currentMoodDayRoute = typeof getCurrentAppRoute === 'function' ? getCurrentAppRoute() : null;
        if (currentMoodDayRoute && currentMoodDayRoute.fullPath !== route?.fullPath) return;
        entries = moodEntriesByDate[dateKey] || [];
    }
    if (!entries.length) {
        if (typeof appBack === 'function') appBack('/');
        return;
    }
    activeMoodDetailDate = dateKey;
    const title = document.getElementById('mood-day-modal-title');
    const list = document.getElementById('mood-day-list');
    if (!title || !list) return;
    title.textContent = `${formatMoodDateTitle(dateKey)} · ${entries.length} 条`;
    const fragment = document.createDocumentFragment();
    entries.forEach(entry => fragment.appendChild(createMoodDayEntry(entry)));
    list.replaceChildren(fragment);
}

function closeMoodDayModal() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function leaveMoodDayPage() {
    activeMoodDetailDate = '';
}

function editMoodEntry(entryId) {
    const entry = getMoodEntryById(entryId);
    if (!entry || entry.user_id !== currentAuthUser?.id) return;
    moodDetailReturnDate = entry.date;
    openMoodModal(entry.id);
}

async function deleteMoodEntry(entryId) {
    const entry = getMoodEntryById(entryId);
    if (!entry || entry.user_id !== currentAuthUser?.id || !isAuthenticated()) return;
    if (!window.confirm('确定删除这条心情记录吗？删除后无法恢复。')) return;

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const dateKey = entry.date;
    const { error } = await supabaseClient
        .from('moods')
        .delete()
        .eq('id', entry.id)
        .eq('user_id', userId);

    if (!isCurrentAuthSnapshot(epoch, userId)) return;
    if (error) {
        console.error('删除心情失败:', error);
        if (typeof showToast === 'function') showToast('删除失败，请稍后重试。');
        return;
    }

    if (dateKey === getAppDateKey()) todayOwnMoodCount = Math.max(0, todayOwnMoodCount - 1);
    await loadMoods(currentMoodMonthKey);
    const stillViewingDeletedMoodDay = (
        (typeof isAppRouteActive !== 'function' || isAppRouteActive('mood-day'))
        && activeMoodDetailDate === dateKey
    );
    if (stillViewingDeletedMoodDay) {
        if ((moodEntriesByDate[dateKey] || []).length) {
            enterMoodDayPage({ params: { date: dateKey } });
        } else {
            closeMoodDayModal();
        }
    }
    if (typeof refreshMoodReminderState === 'function') await refreshMoodReminderState();
}

function resetMoodState() {
    moodLoadRequestId += 1;
    currentMoodMonthKey = '';
    moodEntriesByDate = {};
    activeMoodDetailDate = '';
    editingMoodId = null;
    isMoodSaving = false;
    todayOwnMoodCount = 0;
}
