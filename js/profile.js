// ==========================================================================
// 个人主页与资料管理逻辑 (js/profile.js)
// ==========================================================================

let pendingAvatarFile = null;
let pendingAvatarPreviewUrl = '';
let isProfileSaving = false;
let profileStatsRequestGeneration = 0;
let currentViewingProfileAuthor = '';

function getProfileAvatarUrl(profile) {
    if (!profile) return '';
    return sanitizeMediaUrl(profile._avatarResolvedUrl || profile.avatar_url || '');
}

async function hydrateProfileAvatar(profile) {
    if (!profile) return profile;

    profile._avatarResolvedUrl = sanitizeMediaUrl(profile.avatar_url || '');
    if (!profile.avatar_path || !currentAuthUser) return profile;

    const { data, error } = await supabaseClient.storage
        .from('photos')
        .createSignedUrl(profile.avatar_path, 60 * 60);

    if (!error && data?.signedUrl) {
        profile._avatarResolvedUrl = sanitizeMediaUrl(data.signedUrl);
    }
    return profile;
}

function renderAvatar(container, profile, options = {}) {
    if (!container) return;
    const {
        imageClass = '',
        placeholderClass = 'avatar-placeholder',
        alt = '头像',
        previewUrl = ''
    } = options;

    container.replaceChildren();
    const safeUrl = previewUrl
        ? sanitizeMediaUrl(previewUrl, { allowBlob: true })
        : getProfileAvatarUrl(profile);

    if (safeUrl) {
        const image = document.createElement('img');
        image.src = safeUrl;
        image.alt = alt;
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        if (imageClass) image.className = imageClass;
        container.appendChild(image);
        return;
    }

    const placeholder = document.createElement('div');
    placeholder.className = placeholderClass;
    placeholder.textContent = profile?.username === '小蛇' ? '🐍' : '🐟';
    placeholder.setAttribute('aria-hidden', 'true');
    container.appendChild(placeholder);
}

// ── 个人信息扩展解析与序列化 (兼容纯文本 bio 与 JSON 结构) ──
function parseProfileBio(rawBio, username = '') {
    const isXi = username === '小奚';
    const isSnake = username === '小蛇';

    const defaultQuote = isXi ? '小笨蛋 我爱你！ 💕' : '永远爱我们的小奚 💕';
    const defaultBirthday = isXi ? '2003.07.11' : (isSnake ? '1998.08.15' : '2003.05.20');
    const defaultLocation = '中国 · 温暖的小窝';
    const defaultBio = '热爱生活，喜欢你 💕';

    if (!rawBio) {
        return {
            quote: defaultQuote,
            birthday: defaultBirthday,
            location: defaultLocation,
            bio: defaultBio,
            isCustomQuote: false,
            isCustomBirthday: false,
            isCustomLocation: false,
            isCustomBio: false
        };
    }

    const trimmed = String(rawBio).trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
                return {
                    quote: parsed.quote || defaultQuote,
                    birthday: parsed.birthday || defaultBirthday,
                    location: parsed.location || defaultLocation,
                    bio: parsed.bio || defaultBio,
                    isCustomQuote: Boolean(parsed.quote),
                    isCustomBirthday: Boolean(parsed.birthday),
                    isCustomLocation: Boolean(parsed.location),
                    isCustomBio: Boolean(parsed.bio)
                };
            }
        } catch (_e) {
            // fallback to plain bio text
        }
    }

    return {
        quote: defaultQuote,
        birthday: defaultBirthday,
        location: defaultLocation,
        bio: trimmed,
        isCustomQuote: false,
        isCustomBirthday: false,
        isCustomLocation: false,
        isCustomBio: true
    };
}

function serializeProfileBio(quote, birthday, location, bio) {
    const cleanQuote = String(quote || '').trim();
    const cleanBirthday = String(birthday || '').trim();
    const cleanLocation = String(location || '').trim();
    const cleanBio = String(bio || '').trim();

    if (!cleanQuote && !cleanBirthday && !cleanLocation) {
        return cleanBio;
    }

    return JSON.stringify({
        quote: cleanQuote,
        birthday: cleanBirthday,
        location: cleanLocation,
        bio: cleanBio
    });
}

// ── 相伴天数与纪念日计算 ──
function getTogetherDays() {
    const now = new Date();
    const start = (typeof startDate !== 'undefined' && startDate instanceof Date)
        ? startDate
        : new Date(2026, 4, 23, 1, 0, 0);
    const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff + 1);
}

function renderProfileAnniversaries(container) {
    if (!container) return;
    const now = new Date();
    const currentYear = now.getFullYear();
    const todayOrdinal = Date.UTC(currentYear, now.getMonth(), now.getDate());

    const annivList = (typeof ANNIVERSARIES !== 'undefined' && Array.isArray(ANNIVERSARIES))
        ? ANNIVERSARIES
        : [
            { name: '在一起', icon: '💑', month: 5, day: 23 },
            { name: '小奚生日', icon: '🎂', month: 7, day: 11 },
            { name: '小蛇生日', icon: '🎂', month: 8, day: 15 }
        ];

    const cards = [];

    // 卡片 1: 在一起 / 第一次见面
    const start = (typeof startDate !== 'undefined' && startDate instanceof Date)
        ? startDate
        : new Date(2026, 4, 23, 1, 0, 0);
    const startYearStr = start.getFullYear();
    const startMonthStr = String(start.getMonth() + 1).padStart(2, '0');
    const startDayStr = String(start.getDate()).padStart(2, '0');
    const togetherDays = getTogetherDays();

    cards.push({
        icon: '🌟',
        name: '在一起',
        date: `${startYearStr}.${startMonthStr}.${startDayStr}`,
        badge: `${togetherDays} 天前`
    });

    // 其它纪念日 (生日等倒计时)
    annivList.forEach(item => {
        if (cards.length >= 3) return;
        if (item.name === '在一起') return;

        let year = currentYear;
        let targetOrdinal = Date.UTC(year, item.month - 1, item.day);
        if (targetOrdinal < todayOrdinal) {
            year += 1;
            targetOrdinal = Date.UTC(year, item.month - 1, item.day);
        }
        const diffDays = Math.round((targetOrdinal - todayOrdinal) / 86400000);
        const isToday = diffDays === 0;

        const mStr = String(item.month).padStart(2, '0');
        const dStr = String(item.day).padStart(2, '0');

        cards.push({
            icon: item.icon || '🎉',
            name: item.name,
            date: `${mStr}.${dStr}`,
            badge: isToday ? '🎉 今天！' : `还有 ${diffDays} 天`
        });
    });

    // 如果不足 3 个卡片，用温馨卡片补充
    if (cards.length < 3) {
        cards.push({
            icon: '💖',
            name: '心动纪念',
            date: '每一天',
            badge: '永远爱你'
        });
    }

    const fragment = document.createDocumentFragment();
    cards.slice(0, 3).forEach(card => {
        const itemEl = document.createElement('div');
        itemEl.className = 'profile-anniv-item';

        const iconEl = document.createElement('div');
        iconEl.className = 'anniv-icon';
        iconEl.textContent = card.icon;
        iconEl.setAttribute('aria-hidden', 'true');

        const titleEl = document.createElement('div');
        titleEl.className = 'anniv-title';
        titleEl.textContent = card.name;

        const dateEl = document.createElement('div');
        dateEl.className = 'anniv-date';
        dateEl.textContent = card.date;

        const badgeEl = document.createElement('div');
        badgeEl.className = 'anniv-badge';
        badgeEl.textContent = card.badge;

        itemEl.append(iconEl, titleEl, dateEl, badgeEl);
        fragment.appendChild(itemEl);
    });

    container.replaceChildren(fragment);
}

// ── 加载与更新用户资料 ──
async function loadUserProfile() {
    if (!currentAuthUser) return;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;

    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('user_id, space_id, username, nickname, bio, avatar_url, avatar_path, updated_at')
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        await hydrateProfileAvatar(data);
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        currentUserProfile = data;
        allProfilesCache[data.username] = data;
        updateAvatarButton();
    } catch (error) {
        console.error('加载个人资料失败:', error);
    }
}

function updateAvatarButton() {
    const avatarButton = document.getElementById('user-avatar-btn');
    if (!avatarButton || !currentUserProfile) return;
    renderAvatar(avatarButton, currentUserProfile);
}

function withViewTransition(action) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.startViewTransition && !reduceMotion) {
        document.startViewTransition(action);
    } else {
        action();
    }
}

function openProfilePage(targetAuthor = currentAuthor) {
    const author = String(targetAuthor || currentAuthor || '').trim();
    if (!author) return;
    if (typeof appNavigate === 'function') {
        appNavigate(`/profile/${encodeURIComponent(author)}`);
        return;
    }
    window.location.hash = `#/profile/${encodeURIComponent(author)}`;
}

function enterProfilePage(route) {
    const targetAuthor = String(route?.params?.author || currentAuthor || '');
    const profile = allProfilesCache[targetAuthor];
    if (!isAuthenticated()) return;
    if (!profile) {
        if (typeof showToast === 'function') showToast('没有找到这份个人资料。');
        if (typeof appBack === 'function') appBack('/');
        return;
    }

    currentViewingProfileAuthor = targetAuthor;

    withViewTransition(() => {
        renderProfilePage(targetAuthor);
        loadProfileStats(targetAuthor);
    });
    if (typeof startProfileParticles === 'function') startProfileParticles();
}

function closeProfilePage() {
    if (typeof stopProfileParticles === 'function') stopProfileParticles();
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function leaveProfilePage() {
    profileStatsRequestGeneration += 1;
    if (typeof stopProfileParticles === 'function') stopProfileParticles();
}

function renderProfilePage(targetAuthor = currentAuthor) {
    const profile = allProfilesCache[targetAuthor];
    if (!profile) return;

    currentViewingProfileAuthor = targetAuthor;

    // 头像
    renderAvatar(document.getElementById('profile-avatar-wrap'), profile, {
        imageClass: 'profile-avatar',
        placeholderClass: 'profile-avatar-placeholder'
    });

    // 解析字段
    const parsed = parseProfileBio(profile.bio, profile.username);

    // 昵称与账号
    const nicknameEl = document.getElementById('profile-nickname');
    const usernameEl = document.getElementById('profile-username');
    if (nicknameEl) nicknameEl.textContent = profile.nickname || profile.username;
    if (usernameEl) usernameEl.textContent = `@${profile.username}`;

    // 专属情话/头顶短语
    const quoteEl = document.getElementById('profile-quote');
    if (quoteEl) {
        quoteEl.textContent = parsed.quote ? `💖 ${parsed.quote} 💖` : '💖 小笨蛋 我爱你！ 💖';
    }

    // 相伴天数胶囊
    const daysEl = document.getElementById('profile-together-days');
    if (daysEl) {
        daysEl.textContent = String(getTogetherDays());
    }

    // 关于我
    const birthdayEl = document.getElementById('profile-about-birthday');
    const locationEl = document.getElementById('profile-about-location');
    const bioEl = document.getElementById('profile-about-bio');

    if (birthdayEl) birthdayEl.textContent = parsed.birthday || '未填写';
    if (locationEl) locationEl.textContent = parsed.location || '中国';
    if (bioEl) bioEl.textContent = parsed.bio || '还没有签名，快去编辑一下吧~ 💕';

    // 纪念日卡片
    renderProfileAnniversaries(document.getElementById('profile-anniv-grid'));

    // 是否本人查看
    const isSelf = profile.user_id === currentAuthUser?.id;
    const topbarTitleEl = document.getElementById('profile-topbar-title');
    if (topbarTitleEl) {
        topbarTitleEl.textContent = isSelf ? '💖 我的主页 💖' : `💖 ${profile.nickname || profile.username}的主页 💖`;
    }

    const editButtonTop = document.getElementById('profile-edit-btn-top');
    const editButtonBottom = document.getElementById('profile-edit-btn-bottom');
    const settingsButton = document.getElementById('profile-settings-btn');

    if (editButtonTop) editButtonTop.style.display = isSelf ? '' : 'none';
    if (settingsButton) settingsButton.style.display = isSelf ? 'flex' : 'none';

    if (editButtonBottom) {
        if (isSelf) {
            editButtonBottom.textContent = '✨ 装扮我的小窝';
            editButtonBottom.setAttribute('aria-label', '编辑个人资料与装扮');
        } else {
            editButtonBottom.textContent = '💌 给TA写动态';
            editButtonBottom.setAttribute('aria-label', `给${profile.nickname || profile.username}写动态`);
        }
    }
}

function handleProfileBottomAction() {
    const profile = allProfilesCache[currentViewingProfileAuthor];
    const isSelf = !profile || profile.user_id === currentAuthUser?.id;

    if (isSelf) {
        openEditProfilePage();
    } else {
        closeProfilePage();
        setTimeout(() => {
            if (typeof openMomentModal === 'function') {
                openMomentModal();
            }
        }, 220);
    }
}

function isCurrentProfileStatsRequest(requestGeneration, targetAuthor, epoch, userId) {
    if (
        requestGeneration !== profileStatsRequestGeneration
        || !isCurrentAuthSnapshot(epoch, userId)
    ) {
        return false;
    }

    if (typeof getCurrentAppRoute === 'function') {
        const route = getCurrentAppRoute();
        return route?.id === 'profile'
            && String(route.params?.author || '') === targetAuthor;
    }

    return typeof isAppRouteActive !== 'function' || isAppRouteActive('profile');
}

async function loadProfileStats(targetAuthor) {
    const requestGeneration = ++profileStatsRequestGeneration;
    if (!isAuthenticated() || !allProfilesCache[targetAuthor]) return;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const postsElement = document.getElementById('stat-posts');
    const photosElement = document.getElementById('stat-photos');
    if (postsElement) postsElement.textContent = '…';
    if (photosElement) photosElement.textContent = '…';

    const [countResult, mediaResult] = await Promise.all([
        supabaseClient
            .from('moments')
            .select('id', { count: 'exact', head: true })
            .eq('author', targetAuthor),
        supabaseClient
            .from('moments')
            .select('type, content')
            .eq('author', targetAuthor)
            .in('type', ['photo', 'moment'])
    ]);

    if (!isCurrentProfileStatsRequest(
        requestGeneration,
        targetAuthor,
        epoch,
        userId
    )) return;
    if (countResult.error || mediaResult.error) {
        console.error('加载资料统计失败:', countResult.error || mediaResult.error);
        if (postsElement) postsElement.textContent = '—';
        if (photosElement) photosElement.textContent = '—';
        return;
    }

    let photoCount = 0;
    (mediaResult.data || []).forEach(item => {
        if (item.type === 'photo') {
            photoCount += 1;
            return;
        }
        try {
            const content = JSON.parse(item.content);
            if (Array.isArray(content.images)) photoCount += content.images.length;
        } catch (_error) {
            // 损坏的旧记录不计入照片总数。
        }
    });

    if (postsElement) postsElement.textContent = String(countResult.count || 0);
    if (photosElement) photosElement.textContent = String(photoCount);
}

function openEditProfilePage() {
    if (typeof appNavigate === 'function') {
        appNavigate('/profile/edit');
        return;
    }
    window.location.hash = '#/profile/edit';
}

function enterEditProfilePage() {
    if (!isAuthenticated() || !currentUserProfile) return;
    const page = document.getElementById('edit-profile-page');
    const parsed = parseProfileBio(currentUserProfile.bio, currentUserProfile.username);

    const nicknameInput = document.getElementById('edit-nickname');
    const quoteInput = document.getElementById('edit-quote');
    const birthdayInput = document.getElementById('edit-birthday');
    const locationInput = document.getElementById('edit-location');
    const bioInput = document.getElementById('edit-bio');
    const msgElement = document.getElementById('edit-msg');

    if (nicknameInput) nicknameInput.value = currentUserProfile.nickname || currentUserProfile.username || '';
    if (quoteInput) quoteInput.value = parsed.isCustomQuote ? parsed.quote : '';
    if (birthdayInput) birthdayInput.value = parsed.isCustomBirthday ? parsed.birthday : '';
    if (locationInput) locationInput.value = parsed.isCustomLocation ? parsed.location : '';
    if (bioInput) bioInput.value = parsed.isCustomBio ? parsed.bio : '';
    if (msgElement) msgElement.textContent = '';

    renderAvatar(document.getElementById('edit-avatar-circle'), currentUserProfile, {
        placeholderClass: 'avatar-ph'
    });

    clearPendingAvatar();
    page?.scrollTo({ top: 0 });
}

function clearPendingAvatar() {
    pendingAvatarFile = null;
    if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl);
        pendingAvatarPreviewUrl = '';
    }
}

function closeEditProfilePage() {
    if (isProfileSaving) {
        if (typeof showToast === 'function') showToast('资料正在保存，请稍候…');
        return;
    }
    if (typeof appBack === 'function') {
        appBack(`/profile/${encodeURIComponent(currentAuthor || '')}`);
        return;
    }
    window.location.hash = '#/';
}

function leaveEditProfilePage() {
    clearPendingAvatar();
}

function handleAvatarSelect(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    if (!allowedTypes.has(file.type)) {
        if (typeof showToast === 'function') showToast('头像仅支持 JPG、PNG、WebP 或 GIF 图片');
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        if (typeof showToast === 'function') showToast('头像不能超过 5 MB');
        return;
    }

    clearPendingAvatar();
    pendingAvatarFile = file;
    pendingAvatarPreviewUrl = URL.createObjectURL(file);
    renderAvatar(document.getElementById('edit-avatar-circle'), currentUserProfile, {
        previewUrl: pendingAvatarPreviewUrl,
        placeholderClass: 'avatar-ph',
        alt: '头像预览'
    });
}

function avatarExtensionForType(type) {
    return {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif'
    }[type] || '';
}

async function saveProfile() {
    if (!isAuthenticated() || !currentUserProfile || isProfileSaving) return;

    const nickname = document.getElementById('edit-nickname')?.value.trim() || '';
    const quote = document.getElementById('edit-quote')?.value.trim() || '';
    const birthday = document.getElementById('edit-birthday')?.value.trim() || '';
    const location = document.getElementById('edit-location')?.value.trim() || '';
    const bio = document.getElementById('edit-bio')?.value.trim() || '';
    const messageElement = document.getElementById('edit-msg');
    const saveButton = document.getElementById('edit-save-btn');

    if (!nickname || nickname.length > 40) {
        if (messageElement) messageElement.textContent = nickname ? '昵称不能超过 40 个字符' : '昵称不能为空哦~';
        return;
    }
    if (quote.length > 60) {
        if (messageElement) messageElement.textContent = '情话短语不能超过 60 个字符';
        return;
    }
    if (birthday.length > 30) {
        if (messageElement) messageElement.textContent = '生日格式不能超过 30 个字符';
        return;
    }
    if (location.length > 50) {
        if (messageElement) messageElement.textContent = '所在地不能超过 50 个字符';
        return;
    }
    if (bio.length > 300) {
        if (messageElement) messageElement.textContent = '个性签名不能超过 300 个字符';
        return;
    }

    const serializedBio = serializeProfileBio(quote, birthday, location, bio);
    if (serializedBio.length > 1000) {
        if (messageElement) messageElement.textContent = '保存内容超出长度限制，请适当精简';
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const previousAvatarPath = currentUserProfile.avatar_path || '';
    const originalButtonText = saveButton.textContent;
    let uploadedPath = '';
    let profilePersisted = false;
    isProfileSaving = true;
    saveButton.textContent = '保存中…';
    saveButton.disabled = true;
    if (messageElement) messageElement.textContent = '';

    try {
        const updates = {
            nickname,
            bio: serializedBio,
            updated_at: new Date().toISOString()
        };

        if (pendingAvatarFile) {
            let avatarFileToUpload = pendingAvatarFile;
            if (typeof compressImageFile === 'function') {
                avatarFileToUpload = await compressImageFile(pendingAvatarFile, 400, 400, 0.85);
            }
            const extension = avatarExtensionForType(avatarFileToUpload.type);
            const uniqueId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            uploadedPath = `${currentUserProfile.space_id}/${userId}/avatars/${uniqueId}.${extension}`;

            const { error: uploadError } = await supabaseClient.storage
                .from('photos')
                .upload(uploadedPath, avatarFileToUpload, {
                    contentType: avatarFileToUpload.type,
                    cacheControl: '3600',
                    upsert: false
                });
            if (uploadError) throw uploadError;

            updates.avatar_path = uploadedPath;
            updates.avatar_url = null;
        }

        const { data, error } = await supabaseClient
            .from('profiles')
            .update(updates)
            .eq('user_id', userId)
            .select('user_id, space_id, username, nickname, bio, avatar_url, avatar_path, updated_at')
            .single();
        if (error) throw error;
        profilePersisted = true;

        await hydrateProfileAvatar(data);
        if (!isCurrentAuthSnapshot(epoch, userId)) return;

        currentUserProfile = data;
        allProfilesCache[data.username] = data;
        if (uploadedPath && previousAvatarPath && previousAvatarPath !== uploadedPath) {
            try {
                const { error: cleanupError } = await supabaseClient.storage
                    .from('photos')
                    .remove([previousAvatarPath]);
                if (cleanupError) console.warn('清理旧头像失败:', cleanupError);
            } catch (cleanupError) {
                console.warn('清理旧头像失败:', cleanupError);
            }
        }
        updateAvatarButton();
        renderProfilePage(data.username);

        if (messageElement) {
            messageElement.style.color = '#7ab87a';
            messageElement.textContent = '保存成功 ✨';
        }
        clearPendingAvatar();
        setTimeout(() => {
            const stillEditingProfile = typeof isAppRouteActive !== 'function'
                || isAppRouteActive('edit-profile');
            if (isCurrentAuthSnapshot(epoch, userId) && stillEditingProfile) closeEditProfilePage();
        }, 800);
    } catch (error) {
        if (uploadedPath && !profilePersisted) {
            await supabaseClient.storage.from('photos').remove([uploadedPath]);
        }
        if (messageElement) {
            messageElement.style.color = 'var(--primary)';
            messageElement.textContent = '保存失败，请稍后重试。';
        }
        console.error('保存个人资料失败:', error);
    } finally {
        isProfileSaving = false;
        saveButton.textContent = originalButtonText || '保存';
        saveButton.disabled = false;
    }
}
