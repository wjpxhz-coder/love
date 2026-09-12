// ==========================================
// 心情打卡与月历
// ==========================================
const MOOD_EMOJIS = ['', '😢', '😕', '😊', '😄', '🥰', '😚', '😭', '😜', '😌', '🥺', '🥳', '😋', '🥱', '😡', '🤒', '🤔'];
const MOOD_DESCRIPTIONS = {
    1: '难过沮丧 😢',
    2: '有点低落 😕',
    3: '心情不错 😊',
    4: '特别开心 😄',
    5: '幸福满满 🥰',
    6: '想你亲亲 😚',
    7: '大哭委屈 😭',
    8: '调皮搞怪 😜',
    9: '惬意舒适 😌',
    10: '委屈撒娇 🥺',
    11: '嗨皮庆祝 🥳',
    12: '馋嘴干饭 😋',
    13: '困意满满 🥱',
    14: '生气炸毛 😡',
    15: '身体不适 🤒',
    16: '发呆想事 🤔'
};
const MOOD_TIME_ZONE = 'Asia/Shanghai';
const MAX_MOOD_PHOTOS = 9;
let moodSupportsPhotosColumn = true;
let moodSupportsSpecialColumn = true;

function getMoodSelectFields() {
    const fields = ['id', 'user_id', 'date', 'score', 'author', 'note', 'created_at', 'updated_at'];
    if (moodSupportsSpecialColumn) fields.push('is_special');
    if (moodSupportsPhotosColumn) fields.push('photos');
    return fields.join(', ');
}

function buildMoodPayload(score, rawNote, isSpecial, finalPhotos) {
    const payload = { score: Number(score) };
    const cleanNote = String(rawNote || '').trim();
    if (moodSupportsSpecialColumn) {
        payload.is_special = Boolean(isSpecial);
        payload.note = cleanNote || null;
    } else {
        payload.note = isSpecial
            ? (cleanNote ? `✨[特别日子] ${cleanNote}` : '✨[特别日子]')
            : (cleanNote || null);
    }
    if (moodSupportsPhotosColumn) {
        payload.photos = Array.isArray(finalPhotos) ? finalPhotos : [];
    }
    return payload;
}

let moodSelectedFiles = [];
let moodExistingPhotos = [];
let moodPhotosToDeleteOnSave = [];
const moodPhotoPreviewUrls = new Map();

/**
 * 强健解析并规范化照片列表，兼容原生 Array、JSON 字符串以及 PostgreSQL text[] 数组字面量
 */
function normalizeMoodPhotos(val) {
    if (!val) return [];
    if (Array.isArray(val)) {
        return val.map(item => String(item || '').trim()).filter(Boolean);
    }
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed || trimmed === '{}' || trimmed === '[]') return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return parsed.map(item => String(item || '').trim()).filter(Boolean);
                }
            } catch (_e) {}
        }
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const inner = trimmed.slice(1, -1);
            if (!inner) return [];
            const matches = inner.match(/(".*?"|[^",\s]+)/g) || [];
            return matches.map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean);
        }
        if (trimmed.startsWith('storage://') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            return [trimmed];
        }
    }
    return [];
}

function getMoodStorageDirectory() {
    const spaceId = currentUserProfile && String(currentUserProfile.space_id || '');
    const userId = currentAuthUser && String(currentAuthUser.id || '');
    const isSafeSegment = value => /^[A-Za-z0-9_-]+$/.test(value);
    if (!isSafeSegment(spaceId) || !isSafeSegment(userId)) return '';
    return `${spaceId}/${userId}/moods`;
}

function getMoodFileExtension(file) {
    const nameExtension = String(file && file.name || '').split('.').pop().toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(nameExtension)) return nameExtension;
    const typeExtension = String(file && file.type || '').split('/').pop().split(';')[0].toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(typeExtension) ? typeExtension : 'bin';
}

async function removeUploadedMoodObjects(pathsOrRefs) {
    if (!Array.isArray(pathsOrRefs) || !pathsOrRefs.length || !supabaseClient) return;
    const paths = pathsOrRefs.map(val => {
        if (typeof val === 'string' && typeof STORAGE_REFERENCE_PREFIX === 'string' && val.startsWith(STORAGE_REFERENCE_PREFIX)) {
            return typeof getStorageObjectPath === 'function' ? getStorageObjectPath(val) : '';
        }
        return val;
    }).filter(Boolean);
    if (!paths.length) return;
    try {
        const { error } = await supabaseClient.storage.from('photos').remove(paths);
        if (error) console.error('清理心情照片失败:', error);
    } catch (err) {
        console.error('清理心情照片异常:', err);
    }
}

function clearMoodPhotoPreviews() {
    moodPhotoPreviewUrls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (_e) {}
    });
    moodPhotoPreviewUrls.clear();
    moodSelectedFiles = [];
    moodExistingPhotos = [];
    moodPhotosToDeleteOnSave = [];
    const input = document.getElementById('moodPhotoInput');
    if (input) input.value = '';
}

async function renderMoodPhotoPreviews() {
    const container = document.getElementById('moodPhotoPreviewContainer');
    const counter = document.getElementById('moodPhotoCounter');
    if (!container) return;

    const totalCount = moodExistingPhotos.length + moodSelectedFiles.length;
    if (counter) counter.textContent = `${totalCount}/${MAX_MOOD_PHOTOS}`;

    const fragment = document.createDocumentFragment();

    // 1. 渲染编辑时已存在的照片
    if (moodExistingPhotos.length > 0) {
        for (let i = 0; i < moodExistingPhotos.length; i++) {
            const photoRef = moodExistingPhotos[i];
            const item = document.createElement('div');
            item.className = 'mood-photo-preview-item';
            
            const img = document.createElement('img');
            img.className = 'mood-photo-preview-img';
            img.alt = `已选照片 ${i + 1}`;
            
            const directUrl = typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(photoRef) : '';
            const objPath = typeof getStorageObjectPath === 'function' ? getStorageObjectPath(photoRef) : '';
            const cachedUrl = objPath && typeof getCachedSignedMediaUrl === 'function' ? getCachedSignedMediaUrl(objPath) : '';
            
            if (directUrl || cachedUrl) {
                img.src = directUrl || cachedUrl;
            } else if (typeof resolveMediaUrl === 'function') {
                resolveMediaUrl(photoRef).then(resolved => {
                    if (resolved) img.src = resolved;
                });
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'mood-photo-remove-btn';
            removeBtn.textContent = '×';
            removeBtn.title = '删除此照片';
            removeBtn.setAttribute('aria-label', `删除已选照片 ${i + 1}`);
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeMoodExistingPhoto(i);
            };

            item.append(img, removeBtn);
            fragment.appendChild(item);
        }
    }

    // 2. 渲染新选中的待上传照片
    moodSelectedFiles.forEach((file, index) => {
        let blobUrl = moodPhotoPreviewUrls.get(file);
        if (!blobUrl) {
            blobUrl = URL.createObjectURL(file);
            moodPhotoPreviewUrls.set(file, blobUrl);
        }

        const item = document.createElement('div');
        item.className = 'mood-photo-preview-item';

        const img = document.createElement('img');
        img.className = 'mood-photo-preview-img';
        img.src = blobUrl;
        img.alt = `新选照片 ${index + 1}`;

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'mood-photo-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = '删除此照片';
        removeBtn.setAttribute('aria-label', `删除新选照片 ${index + 1}`);
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeMoodSelectedFile(index);
        };

        item.append(img, removeBtn);
        fragment.appendChild(item);
    });

    // 3. 如果未达上限，追加添加按钮
    if (totalCount < MAX_MOOD_PHOTOS) {
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'mood-photo-add-btn';
        addBtn.id = 'moodPhotoAddBtn';
        addBtn.setAttribute('aria-label', '添加照片');
        addBtn.onclick = () => {
            const input = document.getElementById('moodPhotoInput');
            if (input) input.click();
        };

        const icon = document.createElement('span');
        icon.className = 'mood-photo-add-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '+';

        const text = document.createElement('span');
        text.className = 'mood-photo-add-text';
        text.textContent = totalCount === 0 ? '添加照片' : '继续添加';

        addBtn.append(icon, text);
        fragment.appendChild(addBtn);
    }

    container.replaceChildren(fragment);
}

function removeMoodExistingPhoto(index) {
    if (index >= 0 && index < moodExistingPhotos.length) {
        const removed = moodExistingPhotos.splice(index, 1)[0];
        if (removed) moodPhotosToDeleteOnSave.push(removed);
        renderMoodPhotoPreviews();
    }
}

function removeMoodSelectedFile(index) {
    if (index >= 0 && index < moodSelectedFiles.length) {
        const [file] = moodSelectedFiles.splice(index, 1);
        if (file && moodPhotoPreviewUrls.has(file)) {
            try { URL.revokeObjectURL(moodPhotoPreviewUrls.get(file)); } catch (_e) {}
            moodPhotoPreviewUrls.delete(file);
        }
        renderMoodPhotoPreviews();
    }
}

function handleMoodPhotoSelect(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;

    const currentTotal = moodExistingPhotos.length + moodSelectedFiles.length;
    const remainingSlots = MAX_MOOD_PHOTOS - currentTotal;
    if (remainingSlots <= 0) {
        if (typeof showToast === 'function') showToast(`最多只能添加 ${MAX_MOOD_PHOTOS} 张照片哦`);
        if (event.target) event.target.value = '';
        return;
    }

    let filesToAdd = files;
    if (files.length > remainingSlots) {
        filesToAdd = files.slice(0, remainingSlots);
        if (typeof showToast === 'function') showToast(`最多只能添加 ${MAX_MOOD_PHOTOS} 张照片，已选取前 ${remainingSlots} 张`);
    }

    for (const file of filesToAdd) {
        if (!file.type.startsWith('image/')) {
            if (typeof showToast === 'function') showToast('请选择图片格式文件');
            continue;
        }
        if (file.size > 20 * 1024 * 1024) {
            if (typeof showToast === 'function') showToast('单张图片大小不能超过 20MB');
            continue;
        }
        moodSelectedFiles.push(file);
    }

    renderMoodPhotoPreviews();
    if (event.target) event.target.value = '';
}


function isMoodEntrySpecial(entry) {
    if (!entry) return false;
    if (entry.is_special === true || entry.is_special === 'true' || entry.is_special === 1) return true;
    if (typeof entry.note === 'string' && entry.note.includes('✨[特别日子]')) return true;
    return false;
}

function isMoodRetroactive(entry) {
    if (!entry || !entry.date || !entry.created_at) return false;
    const createdAtDateKey = getAppDateKey(new Date(entry.created_at));
    if (!createdAtDateKey) return false;
    return createdAtDateKey > entry.date;
}

function getDisplayMoodNote(note) {
    if (typeof note !== 'string') return '';
    return note.replace(/✨\[特别日子\]\s*/g, '').trim();
}

function handleMoodSpecialToggle(checked) {
    const toggleLabel = document.querySelector('.mood-special-toggle');
    if (toggleLabel) {
        toggleLabel.classList.toggle('is-active', Boolean(checked));
    }
}

function updateMoodSelectedHint(score) {
    const hint = document.getElementById('moodSelectedHint');
    if (!hint) return;
    const normalizedScore = Number(score);
    if (normalizedScore && MOOD_DESCRIPTIONS[normalizedScore]) {
        hint.textContent = `当前选择：${MOOD_DESCRIPTIONS[normalizedScore]}`;
        hint.classList.add('active');
    } else {
        hint.textContent = '请点击表情选择今天的心情';
        hint.classList.remove('active');
    }
}

let selectedMoodScore = 0;
let editingMoodId = null;
let targetMoodCheckinDate = null;
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
    const firstYear = 2025;
    const latestYear = Math.max(currentYear, Number(selectedYear) || 2025, firstYear);
    const expectedOptionCount = latestYear - firstYear + 1;
    if (yearPicker.options.length !== expectedOptionCount || yearPicker.options[0]?.value !== String(latestYear)) {
        const options = document.createDocumentFragment();
        for (let year = latestYear; year >= firstYear; year -= 1) {
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
    const clean = getDisplayMoodNote(note);
    return typeof clean === 'string' ? clean.replace(/\s+/g, ' ').trim() : '';
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
    updateMoodSelectedHint(selectedMoodScore);
    document.getElementById('moodNote').value = entry ? getDisplayMoodNote(entry.note) : '';
    const isSpecial = isMoodEntrySpecial(entry);
    const specialCheckbox = document.getElementById('moodIsSpecial');
    if (specialCheckbox) {
        specialCheckbox.checked = isSpecial;
        handleMoodSpecialToggle(isSpecial);
    }
    document.getElementById('moodModalMsg').textContent = '';

    // 初始化并渲染照片预览
    clearMoodPhotoPreviews();
    const entryPhotos = entry ? normalizeMoodPhotos(entry.photos) : [];
    if (entryPhotos.length > 0) {
        moodExistingPhotos = [...entryPhotos];
    }
    renderMoodPhotoPreviews();
}

function openMoodModal(entryId = null, targetDate = null) {
    targetMoodCheckinDate = targetDate || null;
    const target = entryId === null
        ? '/mood/check-in'
        : `/mood/edit/${encodeURIComponent(String(entryId))}`;
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

function openMoodModalForDate(dateKey = activeMoodDetailDate) {
    const targetDate = dateKey || activeMoodDetailDate || getAppDateKey();
    const today = getAppDateKey();
    if (targetDate > today) {
        if (typeof showToast === 'function') showToast('不能预支未来的心情哦～ 🌱');
        return;
    }
    openMoodModal(null, targetDate);
}

async function loadMoodEntryForRoute(entryId) {
    if (!isAuthenticated()) return null;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    let data = null;
    let error = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        let selectFields = getMoodSelectFields();
        let query = supabaseClient
            .from('moods')
            .select(selectFields)
            .eq('id', entryId)
            .eq('user_id', userId);
        if (currentUserProfile?.space_id) query = query.eq('space_id', currentUserProfile.space_id);
        const res = await query.maybeSingle();
        data = res.data;
        error = res.error;
        if (!error) break;

        const errCode = String(error.code || '');
        const errMsg = String(error.message || '').toLowerCase();
        let stateChanged = false;
        if (moodSupportsSpecialColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('is_special'))) {
            moodSupportsSpecialColumn = false;
            stateChanged = true;
        }
        if (moodSupportsPhotosColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('photos'))) {
            moodSupportsPhotosColumn = false;
            stateChanged = true;
        }
        if (!stateChanged) break;
    }

    if (!isCurrentAuthSnapshot(epoch, userId) || error || !data) return null;
    data.photos = normalizeMoodPhotos(data.photos);
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
    const today = getAppDateKey();
    const checkinDate = entry ? entry.date : (targetMoodCheckinDate || today);

    if (!entry && checkinDate > today) {
        if (typeof showToast === 'function') showToast('不能预支未来的心情哦～ 🌱');
        if (typeof appBack === 'function') appBack('/');
        return;
    }

    if (title) {
        if (entry) {
            title.textContent = `编辑 ${formatMoodDateTitle(entry.date)} 的心情`;
        } else if (checkinDate < today) {
            title.textContent = `补记 ${formatMoodDateTitle(checkinDate)} 的心情 📝`;
        } else if (checkinDate !== today) {
            title.textContent = `记录 ${formatMoodDateTitle(checkinDate)} 的心情 🌈`;
        } else {
            title.textContent = '今日心情打卡 🌈';
        }
    }
    if (submitButton) {
        if (entry) {
            submitButton.textContent = '保存修改';
        } else if (checkinDate < today) {
            submitButton.textContent = '补记心情';
        } else {
            submitButton.textContent = '记录';
        }
    }
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
    targetMoodCheckinDate = null;
    clearMoodPhotoPreviews();
}

function selectMood(score) {
    const normalizedScore = Number(score);
    if (!Number.isInteger(normalizedScore) || normalizedScore < 1 || normalizedScore >= MOOD_EMOJIS.length) return;

    selectedMoodScore = normalizedScore;
    document.querySelectorAll('.mood-emoji-btn').forEach(button => {
        const selected = Number(button.dataset.score) === normalizedScore;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });
    updateMoodSelectedHint(selectedMoodScore);
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
        messageElement.textContent = '请先选择心情表情哦！';
        return;
    }

    const rawNote = document.getElementById('moodNote').value.trim();
    const isSpecial = Boolean(document.getElementById('moodIsSpecial')?.checked);
    if (rawNote.length > 300) {
        messageElement.textContent = '心情记录不能超过 300 个字符';
        return;
    }

    const submitButton = document.getElementById('mood-submit-button');
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const entryBeingEdited = editingMoodId === null ? null : getMoodEntryById(editingMoodId);
    const targetDate = entryBeingEdited ? entryBeingEdited.date : (targetMoodCheckinDate || getAppDateKey());
    const returnDate = targetDate;
    const today = getAppDateKey();

    if (!entryBeingEdited && targetDate > today) {
        messageElement.textContent = '不能预支未来的心情哦～ 🌱';
        if (typeof showToast === 'function') showToast('不能预支未来的心情哦～ 🌱');
        return;
    }

    isMoodSaving = true;
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = entryBeingEdited ? '保存中…' : '记录中…';
    }

    const uploadedObjectPaths = [];
    try {
        let uploadedUrls = [];
        if (moodSelectedFiles.length > 0) {
            const storageDirectory = getMoodStorageDirectory();
            if (!storageDirectory || typeof createStorageReference !== 'function') {
                messageElement.textContent = '当前会话缺少空间信息，请重新登录后再试。';
                return;
            }

            const totalFiles = moodSelectedFiles.length;
            for (let i = 0; i < totalFiles; i++) {
                let file = moodSelectedFiles[i];
                if (submitButton) submitButton.textContent = `⏳ 优化画质 (${i + 1}/${totalFiles})…`;
                if (typeof compressImageFile === 'function') {
                    file = await compressImageFile(file);
                }

                if (submitButton) submitButton.textContent = `⏳ 上传照片 (${i + 1}/${totalFiles})…`;
                const ext = getMoodFileExtension(file);
                const fileName = `${storageDirectory}/${Date.now()}_${i}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
                const { error: upErr } = await supabaseClient.storage
                    .from('photos')
                    .upload(fileName, file, { contentType: file.type || 'application/octet-stream', upsert: false });
                if (upErr) throw upErr;
                uploadedObjectPaths.push(fileName);
                uploadedUrls.push(createStorageReference(fileName));
            }
        }

        const finalPhotos = [...moodExistingPhotos, ...uploadedUrls];
        if (submitButton) submitButton.textContent = entryBeingEdited ? '保存中…' : '记录中…';

        let result = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const currentPayload = buildMoodPayload(selectedMoodScore, rawNote, isSpecial, finalPhotos);
            const currentSelectFields = getMoodSelectFields();

            if (entryBeingEdited) {
                result = await supabaseClient
                    .from('moods')
                    .update(currentPayload)
                    .eq('id', entryBeingEdited.id)
                    .eq('user_id', userId)
                    .select(currentSelectFields)
                    .single();
            } else {
                result = await supabaseClient
                    .from('moods')
                    .insert([{
                        date: targetDate,
                        ...currentPayload
                    }])
                    .select(currentSelectFields)
                    .single();
            }

            if (!result.error) break;

            const errCode = String(result.error.code || '');
            const errMsg = String(result.error.message || '').toLowerCase();
            let stateChanged = false;

            // 1. 若报错指出缺少 is_special
            if (moodSupportsSpecialColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('is_special'))) {
                console.warn('检测到数据库缺少 is_special 列，自动降级为备注模式重试:', result.error);
                moodSupportsSpecialColumn = false;
                stateChanged = true;
            }

            // 2. 若报错指出缺少 photos
            if (moodSupportsPhotosColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('photos'))) {
                if (finalPhotos.length > 0) {
                    console.error('数据库缺少 photos 字段，拒绝静默丢弃用户照片:', result.error);
                    throw new Error('数据库尚未识别 photos 字段，请先在 Supabase 执行迁移脚本');
                }
                moodSupportsPhotosColumn = false;
                stateChanged = true;
            }

            if (!stateChanged) break;
        }

        if (result && result.error) throw result.error;
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        // 清理编辑时被用户移除的已有照片
        if (moodPhotosToDeleteOnSave.length > 0) {
            removeUploadedMoodObjects(moodPhotosToDeleteOnSave);
        }
        clearMoodPhotoPreviews();

        if (!entryBeingEdited && targetDate === getAppDateKey()) todayOwnMoodCount += 1;

        editingMoodId = null;
        targetMoodCheckinDate = null;
        await loadMoods(currentMoodMonthKey || getCurrentMoodMonthKey());
        if (!isCurrentAuthSnapshot(epoch, userId)) return;
        if (typeof showToast === 'function') {
            const isRetroactiveSave = !entryBeingEdited && targetDate < getAppDateKey();
            if (isRetroactiveSave) {
                showToast(finalPhotos.length > 0 ? '往日心情与照片已补记保存 📷✨' : '往日心情已补记保存 📝✨');
            } else {
                showToast(finalPhotos.length > 0 ? '心情与照片已成功保存 📷✨' : '心情已成功保存 ✨');
            }
        }
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
        // 如果已上传但保存失败，回滚清理新上传的照片
        if (uploadedObjectPaths.length > 0) {
            removeUploadedMoodObjects(uploadedObjectPaths);
        }
        if (error?.code === '23505') {
            messageElement.textContent = '数据库仍限制每天一条记录，请先执行最新迁移。';
        } else if (error?.code === '23514') {
            messageElement.textContent = '数据库表情编号或照片数量受限，请检查最新迁移。';
        } else if (String(error?.message || '').includes('photos') || error?.code === '42703' || error?.code === 'PGRST204') {
            messageElement.textContent = '照片保存失败：Supabase 正在同步字段缓存，请稍候重试。';
        } else {
            messageElement.textContent = `保存失败：${error?.message || '请稍后重试。'}`;
        }
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
    if (entries.length) {
        cell.classList.add('has-entries');
    } else {
        cell.classList.add('empty-day');
    }

    const isSpecialDay = entries.some(entry => isMoodEntrySpecial(entry));
    const hasPhotosDay = entries.some(entry => normalizeMoodPhotos(entry.photos).length > 0);

    if (isSpecialDay || hasPhotosDay) {
        const badges = document.createElement('span');
        badges.className = 'mood-calendar-badges';
        badges.setAttribute('aria-hidden', 'true');

        if (isSpecialDay) {
            cell.classList.add('is-special');
            const star = document.createElement('span');
            star.className = 'mood-special-star';
            star.textContent = '✨';
            badges.appendChild(star);
        }

        if (hasPhotosDay) {
            cell.classList.add('has-photos');
            const cam = document.createElement('span');
            cam.className = 'mood-camera-badge';
            cam.textContent = '📷';
            badges.appendChild(cam);
        }

        cell.appendChild(badges);
    }

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
        const specialLabel = isSpecialDay ? '，✨ 特别纪念日' : '';
        const photoLabel = hasPhotosDay ? '，📷 包含照片' : '';
        cell.setAttribute('aria-label', `${formatMoodDateTitle(dateKey)}${specialLabel}${photoLabel}，${entries.length} 条心情记录：${labels}${noteLabel}，点击查看完整记录`);
        cell.addEventListener('click', () => openMoodDayModal(dateKey));
    } else {
        const specialLabel = isSpecialDay ? '，✨ 特别纪念日' : '';
        cell.setAttribute('aria-label', `${formatMoodDateTitle(dateKey)}${specialLabel}，尚未打卡，点击查看或记录`);
        cell.addEventListener('click', () => openMoodDayModal(dateKey));
    }
    return cell;
}

function renderMoodCalendar(monthKey, entriesByDate) {
    const heatmap = document.getElementById('mood-heatmap');
    const prevButton = document.getElementById('mood-calendar-prev');
    const nextButton = document.getElementById('mood-calendar-next');
    if (!heatmap || !updateMoodMonthPicker(monthKey)) return;

    const bounds = getMoodMonthBounds(monthKey);
    const currentMonth = getCurrentMoodMonthKey();
    if (prevButton) prevButton.disabled = monthKey <= '2025-01';
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
    let boundedMonth = requestedMonth > currentMonth ? currentMonth : requestedMonth;
    if (boundedMonth < '2025-01') boundedMonth = '2025-01';
    currentMoodMonthKey = boundedMonth;
    const bounds = getMoodMonthBounds(currentMoodMonthKey);
    const requestId = ++moodLoadRequestId;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    if (status) status.textContent = '正在加载本月心情…';

    let data = null;
    let error = null;

    for (let attempt = 0; attempt < 3; attempt++) {
        let selectFields = getMoodSelectFields();
        let query = supabaseClient
            .from('moods')
            .select(selectFields)
            .gte('date', bounds.firstDate)
            .lte('date', bounds.lastDate)
            .order('date', { ascending: true })
            .order('created_at', { ascending: true });
        if (currentUserProfile?.space_id) query = query.eq('space_id', currentUserProfile.space_id);
        const res = await query;
        data = res.data;
        error = res.error;
        if (!error) break;

        const errCode = String(error.code || '');
        const errMsg = String(error.message || '').toLowerCase();
        let stateChanged = false;
        if (moodSupportsSpecialColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('is_special'))) {
            moodSupportsSpecialColumn = false;
            stateChanged = true;
        }
        if (moodSupportsPhotosColumn && (errCode === '42703' || errCode === 'PGRST204' || errMsg.includes('photos'))) {
            moodSupportsPhotosColumn = false;
            stateChanged = true;
        }
        if (!stateChanged) break;
    }

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
        entry.photos = normalizeMoodPhotos(entry.photos);
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
    if (nextMonth > getCurrentMoodMonthKey() || nextMonth < '2025-01') return;
    loadMoods(nextMonth);
}

function selectMoodMonth(monthKey) {
    let selectedMonth = normalizeMoodMonthKey(monthKey);
    if (selectedMonth > getCurrentMoodMonthKey()) {
        goToCurrentMoodMonth();
        return;
    }
    if (selectedMonth < '2025-01') {
        selectedMonth = '2025-01';
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
    const isSpecial = isMoodEntrySpecial(entry);
    const card = document.createElement('article');
    card.className = `mood-day-entry${entry.user_id === currentAuthUser?.id ? ' own' : ''}${isSpecial ? ' is-special' : ''}`;

    const header = document.createElement('div');
    header.className = 'mood-day-entry-header';
    const identity = document.createElement('strong');
    identity.textContent = `${entry.author || '成员'} ${MOOD_EMOJIS[Number(entry.score)] || ''}`;

    if (isSpecial) {
        const specialBadge = document.createElement('span');
        specialBadge.className = 'mood-day-special-tag';
        specialBadge.textContent = '✨ 特别纪念';
        identity.appendChild(document.createTextNode(' '));
        identity.appendChild(specialBadge);
    }

    if (isMoodRetroactive(entry)) {
        const retroBadge = document.createElement('span');
        retroBadge.className = 'mood-day-retro-tag';
        retroBadge.textContent = '📝 补记';
        const createdDateKey = getAppDateKey(new Date(entry.created_at));
        retroBadge.title = createdDateKey ? `于 ${formatMoodDateTitle(createdDateKey)} 弥补记录` : '事后弥补记录';
        identity.appendChild(document.createTextNode(' '));
        identity.appendChild(retroBadge);
    }

    const time = document.createElement('time');
    time.dateTime = entry.created_at || '';
    time.textContent = formatMoodEntryTime(entry);
    header.append(identity, time);
    card.appendChild(header);

    const cleanNote = getDisplayMoodNote(entry.note);
    const note = document.createElement('p');
    note.className = `mood-day-entry-note${cleanNote ? '' : ' empty'}`;
    note.textContent = cleanNote || '没有留下文字';
    card.appendChild(note);

    const entryPhotos = normalizeMoodPhotos(entry.photos);
    if (entryPhotos.length > 0) {
        const photosGrid = document.createElement('div');
        photosGrid.className = 'mood-day-photos-grid';
        if (entryPhotos.length === 1) {
            photosGrid.classList.add('single-photo');
        } else if (entryPhotos.length === 2) {
            photosGrid.classList.add('double-photo');
        } else if (entryPhotos.length === 4) {
            photosGrid.classList.add('quad-photo');
        }

        entryPhotos.forEach((photoRef, photoIdx) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'mood-day-photo-item';
            photoItem.setAttribute('role', 'button');
            photoItem.setAttribute('tabindex', '0');
            photoItem.setAttribute('aria-label', `查看第 ${photoIdx + 1} 张照片大图`);

            const img = document.createElement('img');
            img.className = 'mood-day-photo-img';
            img.alt = `${entry.author || '成员'}的心情照片 ${photoIdx + 1}`;
            img.loading = 'lazy';

            const directUrl = typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(photoRef) : '';
            const objPath = typeof getStorageObjectPath === 'function' ? getStorageObjectPath(photoRef) : '';
            const cachedUrl = objPath && typeof getCachedSignedMediaUrl === 'function' ? getCachedSignedMediaUrl(objPath) : '';

            const applyImgSrc = (src) => {
                if (!src) return;
                img.src = src;
                img.onload = () => photoItem.classList.add('is-loaded');
                img.onerror = () => {
                    photoItem.classList.add('is-loaded');
                    photoItem.title = '图片加载失败';
                };
                photoItem.onclick = () => {
                    if (typeof openLightbox === 'function') openLightbox(src);
                };
                photoItem.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (typeof openLightbox === 'function') openLightbox(src);
                    }
                };
            };

            if (directUrl || cachedUrl) {
                applyImgSrc(directUrl || cachedUrl);
            } else if (typeof resolveMediaUrl === 'function') {
                resolveMediaUrl(photoRef).then(resolved => {
                    if (resolved) applyImgSrc(resolved);
                });
            }

            photoItem.appendChild(img);
            photosGrid.appendChild(photoItem);
        });

        card.appendChild(photosGrid);
    }

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

function updateMoodDayMarkButton(isSpecial) {
    const markButton = document.getElementById('mood-day-mark-button');
    if (markButton) {
        markButton.classList.toggle('is-active', Boolean(isSpecial));
        markButton.textContent = isSpecial ? '✨ 已点亮金光' : '✨ 标记这天';
        markButton.title = isSpecial ? '点击取消这天的金光标记' : '点击为这一天点亮金光';
    }
    const emptyMarkBtn = document.getElementById('mood-day-empty-mark-btn');
    if (emptyMarkBtn) {
        emptyMarkBtn.classList.toggle('is-active', Boolean(isSpecial));
        emptyMarkBtn.textContent = isSpecial ? '✨ 取消金光' : '✨ 点亮金光';
    }
}

async function enterMoodDayPage(route) {
    const dateKey = String(route?.params?.date || '');
    if (!dateKey) {
        if (typeof appBack === 'function') appBack('/');
        return;
    }
    let entries = moodEntriesByDate[dateKey] || [];
    if (!entries.length && /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && isAuthenticated()) {
        await loadMoods(dateKey.slice(0, 7));
        const currentMoodDayRoute = typeof getCurrentAppRoute === 'function' ? getCurrentAppRoute() : null;
        if (currentMoodDayRoute && currentMoodDayRoute.fullPath !== route?.fullPath) return;
        entries = moodEntriesByDate[dateKey] || [];
    }

    // 预热并批量解析当日心情中的所有照片地址
    const dayPhotoPaths = [];
    entries.forEach(entry => {
        const photos = normalizeMoodPhotos(entry.photos);
        if (photos.length > 0) {
            dayPhotoPaths.push(...photos);
        }
    });
    if (dayPhotoPaths.length > 0 && typeof batchResolveMediaUrls === 'function') {
        await batchResolveMediaUrls(dayPhotoPaths);
    }

    activeMoodDetailDate = dateKey;
    const title = document.getElementById('mood-day-modal-title');
    const list = document.getElementById('mood-day-list');
    const emptyActions = document.getElementById('mood-day-empty-actions');
    const appendBox = document.getElementById('mood-day-append-box');
    const appendText = document.getElementById('mood-day-append-text');
    const emptyDecor = document.getElementById('mood-day-empty-decor');
    const emptyTip = document.getElementById('mood-day-empty-tip');
    const emptyBtnGroup = document.getElementById('mood-day-empty-btn-group');
    const emptyAddBtn = document.getElementById('mood-day-empty-add-btn');
    const markButton = document.getElementById('mood-day-mark-button');
    if (!title || !list) return;

    const todayKey = getAppDateKey();
    const isFuture = dateKey > todayKey;
    const isToday = dateKey === todayKey;
    const hasSpecialInDay = entries.some(entry => isMoodEntrySpecial(entry));

    if (markButton) {
        markButton.hidden = isFuture;
    }

    if (isFuture) {
        title.textContent = `${formatMoodDateTitle(dateKey)} · 未至`;
    } else {
        title.textContent = `${formatMoodDateTitle(dateKey)}${hasSpecialInDay ? ' ✨' : ''} · ${entries.length} 条`;
    }

    if (!entries.length) {
        list.replaceChildren();
        if (emptyActions) emptyActions.hidden = false;
        if (appendBox) appendBox.hidden = true;

        if (isFuture) {
            if (emptyDecor) emptyDecor.textContent = '🌱';
            if (emptyTip) emptyTip.textContent = '这是未来的日子，不能预支未来的心情哦～';
            if (emptyBtnGroup) emptyBtnGroup.hidden = true;
        } else {
            if (emptyDecor) emptyDecor.textContent = '✨';
            if (emptyTip) emptyTip.textContent = '这一天还没有心情记录～';
            if (emptyBtnGroup) emptyBtnGroup.hidden = false;
            if (emptyAddBtn) {
                emptyAddBtn.textContent = isToday ? '✨ 记录今天的心情' : '🌈 补记这天的心情';
            }
        }
        updateMoodDayMarkButton(hasSpecialInDay);
        return;
    }

    if (emptyActions) emptyActions.hidden = true;
    updateMoodDayMarkButton(hasSpecialInDay);

    const fragment = document.createDocumentFragment();
    entries.forEach(entry => fragment.appendChild(createMoodDayEntry(entry)));
    list.replaceChildren(fragment);

    if (appendBox) {
        if (isFuture) {
            appendBox.hidden = true;
        } else {
            appendBox.hidden = false;
            if (appendText) {
                appendText.textContent = isToday ? '再记一条今天的心情' : '补记一条心情';
            }
        }
    }
}

async function toggleMoodDaySpecial(targetDateKey = activeMoodDetailDate) {
    if (!isAuthenticated()) {
        openLoginModal();
        return;
    }
    const dateKey = targetDateKey || activeMoodDetailDate;
    if (!dateKey || isMoodSaving) return;

    const today = getAppDateKey();
    if (dateKey > today) {
        if (typeof showToast === 'function') showToast('未来日期的金光标记还没到来哦～ 🌱');
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const entries = moodEntriesByDate[dateKey] || [];
    const isCurrentlySpecial = entries.some(entry => isMoodEntrySpecial(entry));
    const markButton = document.getElementById('mood-day-mark-button');
    const emptyMarkBtn = document.getElementById('mood-day-empty-mark-btn');

    isMoodSaving = true;
    if (markButton) markButton.disabled = true;
    if (emptyMarkBtn) emptyMarkBtn.disabled = true;

    try {
        if (!isCurrentlySpecial) {
            // 开启标记：若当前用户在该天已有心情，直接更新；若无，则为该天新建一条特别标记记录
            const ownEntry = entries.find(entry => entry.user_id === userId);
            if (ownEntry) {
                if (moodSupportsSpecialColumn) {
                    let selectFields = getMoodSelectFields();
                    let res = await supabaseClient
                        .from('moods')
                        .update({ is_special: true })
                        .eq('id', ownEntry.id)
                        .eq('user_id', userId)
                        .select(selectFields)
                        .single();
                    if (res.error && moodSupportsPhotosColumn && (res.error.code === '42703' || res.error.code === 'PGRST204' || String(res.error.message).includes('photos'))) {
                        moodSupportsPhotosColumn = false;
                        selectFields = getMoodSelectFields();
                        res = await supabaseClient
                            .from('moods')
                            .update({ is_special: true })
                            .eq('id', ownEntry.id)
                            .eq('user_id', userId)
                            .select(selectFields)
                            .single();
                    }
                    if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204' || String(res.error.message).includes('is_special'))) {
                        moodSupportsSpecialColumn = false;
                        const fallbackNote = ownEntry.note ? `✨[特别日子] ${getDisplayMoodNote(ownEntry.note)}` : '✨[特别日子]';
                        await supabaseClient
                            .from('moods')
                            .update({ note: fallbackNote })
                            .eq('id', ownEntry.id)
                            .eq('user_id', userId);
                    }
                } else {
                    const fallbackNote = ownEntry.note ? `✨[特别日子] ${getDisplayMoodNote(ownEntry.note)}` : '✨[特别日子]';
                    await supabaseClient
                        .from('moods')
                        .update({ note: fallbackNote })
                        .eq('id', ownEntry.id)
                        .eq('user_id', userId);
                }
            } else {
                // 当前用户没有记录，创建一条专属标记（默认 score 5 幸福满满）
                if (moodSupportsSpecialColumn) {
                    let selectFields = getMoodSelectFields();
                    let res = await supabaseClient
                        .from('moods')
                        .insert([{
                            date: dateKey,
                            score: 5,
                            note: null,
                            is_special: true
                        }])
                        .select(selectFields)
                        .single();
                    if (res.error && moodSupportsPhotosColumn && (res.error.code === '42703' || res.error.code === 'PGRST204' || String(res.error.message).includes('photos'))) {
                        moodSupportsPhotosColumn = false;
                        selectFields = getMoodSelectFields();
                        res = await supabaseClient
                            .from('moods')
                            .insert([{
                                date: dateKey,
                                score: 5,
                                note: null,
                                is_special: true
                            }])
                            .select(selectFields)
                            .single();
                    }
                    if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204' || String(res.error.message).includes('is_special'))) {
                        moodSupportsSpecialColumn = false;
                        await supabaseClient
                            .from('moods')
                            .insert([{
                                date: dateKey,
                                score: 5,
                                note: '✨[特别日子]'
                            }]);
                    }
                } else {
                    await supabaseClient
                        .from('moods')
                        .insert([{
                            date: dateKey,
                            score: 5,
                            note: '✨[特别日子]'
                        }]);
                }
                if (dateKey === getAppDateKey()) todayOwnMoodCount += 1;
            }
            if (typeof showToast === 'function') showToast(`已为 ${formatMoodDateTitle(dateKey)} 点亮金光 ✨`);
        } else {
            // 取消标记：遍历当天当前用户的记录并移除标记
            const ownEntries = entries.filter(entry => entry.user_id === userId);
            for (const entry of ownEntries) {
                const cleanNote = getDisplayMoodNote(entry.note);
                if (moodSupportsSpecialColumn) {
                    let res = await supabaseClient
                        .from('moods')
                        .update({ is_special: false, note: cleanNote || null })
                        .eq('id', entry.id)
                        .eq('user_id', userId);
                    if (res.error && (res.error.code === '42703' || res.error.code === 'PGRST204' || String(res.error.message).includes('is_special'))) {
                        moodSupportsSpecialColumn = false;
                        await supabaseClient
                            .from('moods')
                            .update({ note: cleanNote || null })
                            .eq('id', entry.id)
                            .eq('user_id', userId);
                    }
                } else {
                    await supabaseClient
                        .from('moods')
                        .update({ note: cleanNote || null })
                        .eq('id', entry.id)
                        .eq('user_id', userId);
                }
            }
            if (typeof showToast === 'function') showToast('已取消该天的金光标记');
        }

        if (!isCurrentAuthSnapshot(epoch, userId)) return;
        await loadMoods(dateKey.slice(0, 7));
        if (!isCurrentAuthSnapshot(epoch, userId)) return;
        if (typeof isAppRouteActive !== 'function' || isAppRouteActive('mood-day')) {
            enterMoodDayPage({ params: { date: dateKey } });
        }
        if (typeof refreshMoodReminderState === 'function') await refreshMoodReminderState();
    } catch (error) {
        console.error('切换特别标记失败:', error);
        if (typeof showToast === 'function') showToast('操作失败，请稍后重试。');
    } finally {
        isMoodSaving = false;
        if (markButton) markButton.disabled = false;
        if (emptyMarkBtn) emptyMarkBtn.disabled = false;
    }
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
    const photosToDelete = normalizeMoodPhotos(entry.photos);

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

    if (photosToDelete.length > 0) {
        removeUploadedMoodObjects(photosToDelete);
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
    targetMoodCheckinDate = null;
    editingMoodId = null;
    isMoodSaving = false;
    todayOwnMoodCount = 0;
    clearMoodPhotoPreviews();
}


