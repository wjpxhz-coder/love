// ==========================================
// 4. 交互逻辑
// ==========================================
let currentAction = '';
let currentAuthor = localStorage.getItem('lover_identity') || '';
let pendingDeleteId = null;
let pendingCommentMomentId = null;
let pendingDeleteCommentId = null;
let pendingDeleteCommentMomentId = null;

let allProfilesCache = {};
try {
    const cached = localStorage.getItem('all_profiles_cache');
    if (cached) allProfilesCache = JSON.parse(cached);
} catch(e) {}

async function fetchAllProfiles() {
    try {
        const { data, error } = await supabaseClient.from('profiles').select('*');
        if (!error && data) {
            data.forEach(p => { allProfilesCache[p.username] = p; });
            localStorage.setItem('all_profiles_cache', JSON.stringify(allProfilesCache));
        }
    } catch(e) {}
}

// ==========================================
// 新登录系统
// ==========================================

async function initAuth() {
    // 预加载所有用户资料
    fetchAllProfiles();
    // 确保 profiles 表存在（通过 upsert 触发）
    await ensureProfilesTable();

    const saved = localStorage.getItem('lover_identity');
    if (saved && VALID_USERS.includes(saved)) {
        currentAuthor = saved;
        await onLoginSuccess(currentAuthor, false);
    }
}

async function ensureProfilesTable() {
    // 尝试查询 profiles 表，如果不存在则通过 SQL 创建
    const { error } = await supabaseClient.from('profiles').select('username').limit(1);
    if (error && error.code === '42P01') {
        // 表不存在，需要在 Supabase 中创建
        console.log('profiles 表不存在，请在 Supabase 控制台执行建表 SQL');
    }
}

function openLoginModal() {
    const overlay = document.getElementById('login-overlay');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').innerText = '';
    overlay.showModal();
    startLoginCanvas();
    setTimeout(() => document.getElementById('login-username').focus(), 200);
}

function closeLoginModal() {
    document.getElementById('login-overlay').close();
    stopLoginCanvas();
}

function toggleLoginPwEye() {
    const pw = document.getElementById('login-password');
    const eye = document.getElementById('login-pw-eye');
    if (pw.type === 'password') {
        pw.type = 'text';
        eye.textContent = '🙈';
    } else {
        pw.type = 'password';
        eye.textContent = '👁';
    }
}

async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    if (!username) { errEl.innerText = '请输入账号 💕'; return; }
    if (!password) { errEl.innerText = '请输入密码 🔐'; return; }
    if (!VALID_USERS.includes(username)) { errEl.innerText = '账号不存在，请输入「小蛇」或「小奚」'; return; }

    const { data: isValid, error } = await supabaseClient.rpc('verify_login', {
        p_username: username,
        p_password: password
    });

    if (error || !isValid) { 
        errEl.innerText = '密码不对哦，再想想~ 💭'; 
        return; 
    }

    errEl.innerText = '';
    btn.innerHTML = '💖 登录中…';
    btn.disabled = true;

    currentAuthor = username;
    localStorage.setItem('lover_identity', username);

    await onLoginSuccess(username, true);
    btn.innerHTML = '✨ 进入我们的世界';
    btn.disabled = false;
    closeLoginModal();
}

async function onLoginSuccess(username, isNewLogin) {
    // 更新 UI：隐藏登录按钮，显示头像按钮
    document.getElementById('login-trigger-btn').style.display = 'none';
    const avatarBtn = document.getElementById('user-avatar-btn');
    avatarBtn.style.display = 'flex';
    document.getElementById('user-name-label').textContent = `@${username}`;

    // 加载 profile
    await loadUserProfile(username);

    // 更新同频共振
    if (presenceChannel) updatePresence();

    // 加载通知
    setTimeout(loadNotifications, 500);

    if (isNewLogin) {
        // 登录成功爱心动画
        spawnHearts(window.innerWidth / 2, window.innerHeight / 2);
    }

    // 自动检测版本更新，并在 1.2 秒后展示，防止视觉冲突
    setTimeout(async () => {
        try {
            const res = await fetch('./sw.js?t=' + Date.now());
            if (!res.ok) return;
            const text = await res.text();
            const match = text.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
            if (match && match[1]) {
                const currentCacheVersion = match[1]; // 例如 'love-diary-v3.3.0'
                const lastSeen = localStorage.getItem('last_seen_version');
                
                // 如果本地已记录过版本，且与当前的 SW 缓存名称不一致，说明发生了更新！
                if (lastSeen && lastSeen !== currentCacheVersion) {
                    // 兼容判断：去除 'love-diary-' 前缀后比对，确保 config.js 中的 APP_VERSION 与 SW 中的 CACHE_NAME 匹配
                    const useConfigLog = (typeof APP_VERSION !== 'undefined' && 
                        (currentCacheVersion === APP_VERSION || 
                         currentCacheVersion.replace('love-diary-', '') === APP_VERSION.replace('love-diary-', '')));
                    if (typeof showVersionModal === 'function') {
                        showVersionModal(currentCacheVersion, useConfigLog);
                    }
                } else if (!lastSeen) {
                    // 第一次进入网站，做个初始化记录，不频繁弹窗打扰用户
                    localStorage.setItem('last_seen_version', currentCacheVersion);
                }
            }
        } catch (e) {
            console.error('自动检测更新失败:', e);
        }
    }, 1200);
}

function doLogout() {
    hideUserDropdown();
    currentAuthor = '';
    currentUserProfile = null;
    localStorage.removeItem('lover_identity');
    if (typeof processedMissIds !== 'undefined') {
        processedMissIds.clear();
    }
    document.getElementById('login-trigger-btn').style.display = 'flex';
    document.getElementById('user-avatar-btn').style.display = 'none';
    // 重置头像
    const avatarBtn = document.getElementById('user-avatar-btn');
    avatarBtn.innerHTML = '<div class="avatar-placeholder">🌸</div>';
}

function toggleUserDropdown() {
    const dd = document.getElementById('user-dropdown');
    dd.classList.toggle('show');
}

function hideUserDropdown() {
    document.getElementById('user-dropdown').classList.remove('show');
}

// 点击外部关闭下拉
document.addEventListener('click', (e) => {
    const dd = document.getElementById('user-dropdown');
    const avatarBtn = document.getElementById('user-avatar-btn');
    if (dd && dd.classList.contains('show') && !dd.contains(e.target) && !avatarBtn.contains(e.target)) {
        dd.classList.remove('show');
    }
});

// ── 登录弹窗花瓣 Canvas ──
let loginCanvasAnim = null;

function startLoginCanvas() {
    const canvas = document.getElementById('login-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const petals = [];
    const hearts = ['💖','💗','💕','✨','🌸','💝','🌹'];
    for (let i = 0; i < (window.innerWidth < 768 ? 10 : 20); i++) {
        petals.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: 12 + Math.random() * 20,
            speedY: 0.6 + Math.random() * 1.5,
            speedX: (Math.random() - 0.5) * 0.8,
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - 0.5) * 0.04,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.01 + Math.random() * 0.02,
            alpha: 0.4 + Math.random() * 0.6,
            emoji: hearts[Math.floor(Math.random() * hearts.length)]
        });
    }

    let running = true;
    loginCanvasAnim = { running };

    function animate() {
        if (!loginCanvasAnim.running) return;
        if (isCanvasScrolling) {
            requestAnimationFrame(animate);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        petals.forEach(p => {
            p.sway += p.swaySpeed;
            p.x += p.speedX + Math.sin(p.sway) * 0.8;
            p.y += p.speedY;
            p.rot += p.rotSpeed;
            if (p.y > canvas.height + 30) {
                p.y = -30;
                p.x = Math.random() * canvas.width;
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = p.alpha;
            ctx.font = p.size + 'px serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(p.emoji, 0, 0);
            ctx.restore();
        });
        requestAnimationFrame(animate);
    }
    animate();
}

function stopLoginCanvas() {
    if (loginCanvasAnim) loginCanvasAnim.running = false;
}

// 登录弹窗键盘事件
document.getElementById('login-password') && document.getElementById('login-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doLogin();
});
document.getElementById('login-username') && document.getElementById('login-username').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
});

// ==========================================
// 旧版密码弹窗（兼容保留，已登录时直通）
// ==========================================
function checkPassword(actionType) {
    // 已登录则直接执行对应动作
    if (currentAuthor) {
        currentAction = actionType;
        executeAction(actionType);
        return;
    }
    // 未登录则弹出登录弹窗
    openLoginModal();
}

function executeAction(actionType) {
    if (actionType === 'moment') {
        openMomentModal();
    } else if (actionType === 'delete') {
        deleteMoment(pendingDeleteId);
    } else if (actionType === 'mood') {
        openMoodModal();
    } else if (actionType === 'comment') {
        showCommentInput(pendingCommentMomentId);
    } else if (actionType === 'delete_comment') {
        deleteComment(pendingDeleteCommentId, pendingDeleteCommentMomentId);
    }
}

function closeModal() {
    document.getElementById('customModal').close();
}

async function verifyCode() {
    const inputVal = document.getElementById('modalInput').value;
    const msgEl = document.getElementById('modalMsg');

    let matched = null;
    for (const u of VALID_USERS) {
        const { data } = await supabaseClient.rpc('verify_login', { p_username: u, p_password: inputVal });
        if (data) { matched = u; break; }
    }

    if (matched) {
        currentAuthor = matched;
        localStorage.setItem('lover_identity', currentAuthor);
        if (presenceChannel) updatePresence();
        onLoginSuccess(currentAuthor, false);

        msgEl.style.color = '#7ab87a';
        msgEl.innerText = `暗号正确，${currentAuthor} 💖`;
        setTimeout(() => {
            closeModal();
            executeAction(currentAction);
        }, 500);
    } else if (inputVal.trim() === '') {
        msgEl.style.color = '#b5737a';
        msgEl.innerText = '暗号不能为空哦！';
    } else {
        msgEl.style.color = '#b5737a';
        msgEl.innerText = '暗号不对哦，是不是别人在偷看？😎';
    }
}

document.getElementById('modalInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') verifyCode();
});
