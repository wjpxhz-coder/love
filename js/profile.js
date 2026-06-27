// ── 个人主页 ──
async function loadUserProfile(username) {
    let loadedProfile = null;
    try {
        const { data, error } = await supabaseClient
            .from('profiles')
            .select('*')
            .eq('username', username)
            .single();

        if (!error && data) {
            loadedProfile = data;
        }
    } catch(e) {}

    if (!loadedProfile) {
        // 尝试从 localStorage 读取本地缓存（Fallback）
        const local = localStorage.getItem('profile_' + username);
        if (local) {
            try { loadedProfile = JSON.parse(local); } catch(e){}
        }
    }

    if (loadedProfile) {
        currentUserProfile = loadedProfile;
    } else {
        // 初始化默认 profile
        currentUserProfile = { username, nickname: username, bio: '', avatar_url: null };
        // 尝试同步到服务器，失败不报错
        supabaseClient.from('profiles').upsert([currentUserProfile], { onConflict: 'username' }).then(()=>{});
    }
    updateAvatarButton();
}

function updateAvatarButton() {
    const avatarBtn = document.getElementById('user-avatar-btn');
    if (!avatarBtn || !currentUserProfile) return;
    if (currentUserProfile.avatar_url) {
        avatarBtn.innerHTML = `<img src="${currentUserProfile.avatar_url}" alt="头像">`;
    } else {
        const emoji = currentUserProfile.username === '小蛇' ? '🐍' : '🐟';
        avatarBtn.innerHTML = `<div class="avatar-placeholder">${emoji}</div>`;
    }
}

function withViewTransition(action) {
    if (document.startViewTransition) {
        document.startViewTransition(action);
    } else {
        action();
    }
}

function openProfilePage(targetAuthor) {
    if (!targetAuthor) targetAuthor = currentAuthor;
    if (!targetAuthor) return;
    withViewTransition(() => {
        const page = document.getElementById('profile-page');
        page.classList.add('show');
        renderProfilePage(targetAuthor);
        loadProfileStats(targetAuthor);
    });
    startProfileParticles();
}

function closeProfilePage() {
    withViewTransition(() => {
        document.getElementById('profile-page').classList.remove('show');
    });
    stopProfileParticles();
}

function renderProfilePage(targetAuthor) {
    const p = allProfilesCache[targetAuthor] || { username: targetAuthor, nickname: targetAuthor, bio: '' };
    if (!p) return;
    // 头像
    const avatarWrap = document.getElementById('profile-avatar-wrap');
    if (p.avatar_url) {
        avatarWrap.innerHTML = `<img src="${p.avatar_url}" class="profile-avatar" alt="头像">`;
    } else {
        const emoji = p.username === '小蛇' ? '🐍' : '🐟';
        avatarWrap.innerHTML = `<div class="profile-avatar-placeholder">${emoji}</div>`;
    }
    document.getElementById('profile-nickname').textContent = p.nickname || p.username;
    document.getElementById('profile-username').textContent = `@${p.username}`;
    document.getElementById('profile-bio').textContent = p.bio || '还没有签名，快去编辑一下吧~ 💕';

    // 视图切换（本人 / 他人）
    const isSelf = (targetAuthor === currentAuthor);
    document.getElementById('profile-topbar-title').textContent = isSelf ? '我的主页' : 'TA的主页';
    
    const editBtnTop = document.getElementById('profile-edit-btn-top');
    const editBtnBottom = document.getElementById('profile-edit-btn-bottom');
    if (editBtnTop) editBtnTop.style.display = isSelf ? 'block' : 'none';
    if (editBtnBottom) editBtnBottom.style.display = isSelf ? 'block' : 'none';
}

async function loadProfileStats(targetAuthor) {
    if (!targetAuthor) return;
    document.getElementById('stat-posts').textContent = '...';
    document.getElementById('stat-photos').textContent = '...';
    // 总动态数
    const { count: totalCount } = await supabaseClient
        .from('moments')
        .select('id', { count: 'exact', head: true })
        .eq('author', targetAuthor);
    // 照片数（moment 类型中有图片）
    const { data: photoData } = await supabaseClient
        .from('moments')
        .select('content')
        .eq('author', targetAuthor)
        .in('type', ['photo', 'moment']);
    let photoCount = 0;
    if (photoData) {
        photoData.forEach(item => {
            try {
                const d = JSON.parse(item.content);
                if (d.images) photoCount += d.images.length;
            } catch (e) {
                photoCount += 1; // photo 类型
            }
        });
    }
    document.getElementById('stat-posts').textContent = totalCount || 0;
    document.getElementById('stat-photos').textContent = photoCount || 0;
}

function openEditProfilePage() {
    const p = currentUserProfile;
    if (!p) return;
    const page = document.getElementById('edit-profile-page');
    document.getElementById('edit-nickname').value = p.nickname || p.username;
    document.getElementById('edit-bio').value = p.bio || '';
    document.getElementById('edit-msg').innerText = '';
    // 头像预览
    const circle = document.getElementById('edit-avatar-circle');
    if (p.avatar_url) {
        circle.innerHTML = `<img src="${p.avatar_url}" alt="头像">`;
    } else {
        const emoji = p.username === '小蛇' ? '🐍' : '🐟';
        circle.innerHTML = `<div class="avatar-ph">${emoji}</div>`;
    }
    pendingAvatarFile = null;
    withViewTransition(() => {
        page.classList.add('show');
    });
}

function closeEditProfilePage() {
    withViewTransition(() => {
        document.getElementById('edit-profile-page').classList.remove('show');
    });
    pendingAvatarFile = null;
}

let pendingAvatarFile = null;

function handleAvatarSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    pendingAvatarFile = file;
    const url = URL.createObjectURL(file);
        if(window.lastAvatarUrl) URL.revokeObjectURL(window.lastAvatarUrl);
        window.lastAvatarUrl = url;
    const circle = document.getElementById('edit-avatar-circle');
    circle.innerHTML = `<img src="${url}" alt="头像预览" style="width:100%;height:100%;object-fit:cover;">`;
    event.target.value = '';
}

async function saveProfile() {
    const nickname = document.getElementById('edit-nickname').value.trim();
    const bio = document.getElementById('edit-bio').value.trim();
    const msgEl = document.getElementById('edit-msg');
    const saveBtn = document.getElementById('edit-save-btn');

    if (!nickname) { msgEl.style.color = 'var(--primary)'; msgEl.innerText = '昵称不能为空哦~'; return; }

    saveBtn.innerHTML = '保存中…'; saveBtn.disabled = true;
    msgEl.innerText = '';

    try {
        let avatarUrl = currentUserProfile.avatar_url;

        // 上传头像
        if (pendingAvatarFile) {
            const ext = pendingAvatarFile.name.split('.').pop();
            const randomStr = Math.random().toString(36).substring(2,8);
            const fileName = `avatars/avatar_${Date.now()}_${randomStr}.${ext}`;
            const { error: uploadErr } = await supabaseClient.storage
                .from('photos')
                .upload(fileName, pendingAvatarFile, { contentType: pendingAvatarFile.type, upsert: true });
            if (uploadErr) throw uploadErr;
            const { data: urlData } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
            avatarUrl = urlData.publicUrl;
        }

        const updated = { username: currentAuthor, nickname, bio, avatar_url: avatarUrl, updated_at: new Date().toISOString() };
        
        // 尝试保存到服务器
        const { error: upsertErr } = await supabaseClient.from('profiles').upsert([updated], { onConflict: 'username' });
        
        // 无论服务器是否成功，都在本地更新并保存到 localStorage（兼容无表状态）
        currentUserProfile = { ...currentUserProfile, ...updated };
        localStorage.setItem('profile_' + currentAuthor, JSON.stringify(currentUserProfile));
        
        updateAvatarButton();
        renderProfilePage();

        msgEl.style.color = '#7ab87a';
        msgEl.innerText = upsertErr ? '保存成功 (仅本地缓存)' : '保存成功 ✨';
        if (upsertErr) console.warn('Supabase profile save failed, using local cache:', upsertErr);
        
        pendingAvatarFile = null;
        setTimeout(() => closeEditProfilePage(), 800);
    } catch (err) {
        msgEl.style.color = 'var(--primary)';
        msgEl.innerText = '保存失败: ' + err.message;
    } finally {
        saveBtn.innerHTML = '保存'; saveBtn.disabled = false;
    }
}
