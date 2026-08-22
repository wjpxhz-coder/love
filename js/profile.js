// ── 个人主页 ──
let pendingAvatarFile = null;
let pendingAvatarPreviewUrl = '';
let isProfileSaving = false;
let profileStatsRequestGeneration = 0;



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

    renderAvatar(document.getElementById('profile-avatar-wrap'), profile, {
        imageClass: 'profile-avatar',
        placeholderClass: 'profile-avatar-placeholder'
    });

    document.getElementById('profile-nickname').textContent = profile.nickname || profile.username;
    document.getElementById('profile-username').textContent = `@${profile.username}`;
    document.getElementById('profile-bio').textContent = profile.bio || '还没有签名，快去编辑一下吧~ 💕';

    const isSelf = profile.user_id === currentAuthUser?.id;
    document.getElementById('profile-topbar-title').textContent = isSelf ? '我的主页' : 'TA的主页';

    const editButtonTop = document.getElementById('profile-edit-btn-top');
    const editButtonBottom = document.getElementById('profile-edit-btn-bottom');
    const settingsButton = document.getElementById('profile-settings-btn');
    if (editButtonTop) editButtonTop.style.display = isSelf ? 'block' : 'none';
    if (editButtonBottom) editButtonBottom.style.display = isSelf ? 'block' : 'none';
    if (settingsButton) settingsButton.style.display = isSelf ? 'flex' : 'none';
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
    document.getElementById('edit-nickname').value = currentUserProfile.nickname || currentUserProfile.username;
    document.getElementById('edit-bio').value = currentUserProfile.bio || '';
    document.getElementById('edit-msg').textContent = '';
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

    const nickname = document.getElementById('edit-nickname').value.trim();
    const bio = document.getElementById('edit-bio').value.trim();
    const messageElement = document.getElementById('edit-msg');
    const saveButton = document.getElementById('edit-save-btn');

    if (!nickname || nickname.length > 40) {
        messageElement.textContent = nickname ? '昵称不能超过 40 个字符' : '昵称不能为空哦~';
        return;
    }
    if (bio.length > 300) {
        messageElement.textContent = '个人签名不能超过 300 个字符';
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
    messageElement.textContent = '';

    try {
        const updates = {
            nickname,
            bio,
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

        messageElement.style.color = '#7ab87a';
        messageElement.textContent = '保存成功 ✨';
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
        messageElement.style.color = 'var(--primary)';
        messageElement.textContent = '保存失败，请稍后重试。';
        console.error('保存个人资料失败:', error);
    } finally {
        isProfileSaving = false;
        saveButton.textContent = originalButtonText || '保存';
        saveButton.disabled = false;
    }
}


