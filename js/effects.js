// ==========================================
// 一键想你与现代 Toast 提示
// ==========================================
function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        container.style.cssText = `
            position: fixed;
            top: calc(max(24px, env(safe-area-inset-top, 0px)) + 28px);
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            width: max-content;
            max-width: calc(100vw - 32px);
            box-sizing: border-box;
            transition: top 0.3s cubic-bezier(0.25, 1, 0.5, 1);
        `;
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast-item';

    const theme = document.documentElement.getAttribute('data-theme');
    const isDark = theme === 'dark';

    toast.style.cssText = `
        background: ${isDark ? 'rgba(38, 22, 54, 0.88)' : 'rgba(255, 255, 255, 0.88)'};
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: ${isDark ? '#ff8fab' : 'var(--primary)'};
        padding: 11px 22px;
        border-radius: 24px;
        box-shadow: 0 8px 30px var(--shadow-hover), inset 0 1.5px 1px var(--glass-highlight);
        font-weight: 600;
        font-size: 0.92em;
        letter-spacing: 0.5px;
        opacity: 0;
        transform: translateY(-12px) scale(0.92);
        transition: opacity 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        border: 1.5px solid ${isDark ? 'rgba(255, 143, 171, 0.3)' : 'var(--border)'};
        max-width: min(90vw, 420px);
        text-align: center;
        line-height: 1.45;
        word-break: break-word;
        box-sizing: border-box;
        pointer-events: auto;
    `;

    toast.innerText = message;
    container.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.add('show');
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-16px) scale(0.92)';
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, duration);
}

// ==========================================
// 🦋 一键想你专属：美丽蝴蝶从底部飞入，五颜六色变色发光
// ==========================================
const BUTTERFLY_THEMES = [
    {
        name: 'aurora',
        glow: '#38bdf8',
        accent: '#818cf8',
        wingGrad1: ['#00f2fe', '#4facfe', '#6a11cb'],
        wingGrad2: ['#38ef7d', '#11998e', '#0575e6'],
        particleColor: '#67e8f9'
    },
    {
        name: 'dream-pink',
        glow: '#f472b6',
        accent: '#c084fc',
        wingGrad1: ['#ff758c', '#ff7eb3', '#7928ca'],
        wingGrad2: ['#ff9a9e', '#fecfef', '#f43f5e'],
        particleColor: '#fbcfe8'
    },
    {
        name: 'sunset-amber',
        glow: '#fb923c',
        accent: '#f43f5e',
        wingGrad1: ['#ff4e50', '#f9d423', '#f857a6'],
        wingGrad2: ['#ff8008', '#ffc837', '#e11d48'],
        particleColor: '#fef08a'
    },
    {
        name: 'mystic-violet',
        glow: '#c084fc',
        accent: '#38bdf8',
        wingGrad1: ['#b224ef', '#7579ff', '#00d2ff'],
        wingGrad2: ['#e0c3fc', '#8ec5fc', '#9333ea'],
        particleColor: '#e9d5ff'
    },
    {
        name: 'emerald-fairy',
        glow: '#34d399',
        accent: '#6ee7b7',
        wingGrad1: ['#0ba360', '#3cba92', '#30dd8a'],
        wingGrad2: ['#43e97b', '#38f9d7', '#10b981'],
        particleColor: '#a7f3d0'
    },
    {
        name: 'golden-glamour',
        glow: '#facc15',
        accent: '#fb923c',
        wingGrad1: ['#ffe259', '#ffa751', '#ff5858'],
        wingGrad2: ['#f6d365', '#fda085', '#d97706'],
        particleColor: '#fef9c3'
    }
];

let globalButterflySeq = 0;

function createButterflyLeftWing(theme, gradId) {
    return `
        <svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="${gradId}-1" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="${theme.wingGrad1[0]}" stop-opacity="0.95" />
                    <stop offset="50%" stop-color="${theme.wingGrad1[1]}" stop-opacity="0.88" />
                    <stop offset="100%" stop-color="${theme.wingGrad1[2]}" stop-opacity="0.8" />
                </linearGradient>
                <linearGradient id="${gradId}-2" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="${theme.wingGrad2[0]}" stop-opacity="0.9" />
                    <stop offset="50%" stop-color="${theme.wingGrad2[1]}" stop-opacity="0.75" />
                    <stop offset="100%" stop-color="${theme.wingGrad2[2]}" stop-opacity="0.85" />
                </linearGradient>
            </defs>
            <path d="M 98,62 C 95,45 80,18 52,6 C 26,-5 2,2 0,16 C -2,28 12,48 40,58 C 65,66 90,65 98,62 Z" fill="url(#${gradId}-1)" />
            <path d="M 92,60 C 82,46 68,24 48,14 C 30,5 12,12 10,22 C 8,32 20,48 44,55 C 64,61 84,62 92,60 Z" fill="rgba(255, 255, 255, 0.32)" />
            <path d="M 78,55 C 65,40 50,22 34,18 C 22,15 16,22 18,28 C 20,34 32,44 48,49 C 62,53 72,54 78,55 Z" fill="rgba(255, 255, 255, 0.45)" />
            <path d="M 95,65 C 85,75 68,96 46,112 C 34,121 20,128 14,124 C 8,120 10,110 18,98 C 24,90 22,86 16,84 C 10,82 12,74 24,70 C 45,63 78,63 95,65 Z" fill="url(#${gradId}-2)" />
            <path d="M 88,68 C 76,78 58,96 42,106 C 30,114 22,116 20,112 C 18,106 24,96 30,88 C 45,72 70,67 88,68 Z" fill="rgba(255, 255, 255, 0.35)" />
        </svg>
    `;
}

function createButterflyRightWing(theme, gradId) {
    return `
        <svg viewBox="0 0 100 130" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="${gradId}-1" x1="100%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="${theme.wingGrad1[0]}" stop-opacity="0.95" />
                    <stop offset="50%" stop-color="${theme.wingGrad1[1]}" stop-opacity="0.88" />
                    <stop offset="100%" stop-color="${theme.wingGrad1[2]}" stop-opacity="0.8" />
                </linearGradient>
                <linearGradient id="${gradId}-2" x1="100%" y1="100%" x2="0%" y2="0%">
                    <stop offset="0%" stop-color="${theme.wingGrad2[0]}" stop-opacity="0.9" />
                    <stop offset="50%" stop-color="${theme.wingGrad2[1]}" stop-opacity="0.75" />
                    <stop offset="100%" stop-color="${theme.wingGrad2[2]}" stop-opacity="0.85" />
                </linearGradient>
            </defs>
            <path d="M 2,62 C 5,45 20,18 48,6 C 74,-5 98,2 100,16 C 102,28 88,48 60,58 C 35,66 10,65 2,62 Z" fill="url(#${gradId}-1)" />
            <path d="M 8,60 C 18,46 32,24 52,14 C 70,5 88,12 90,22 C 92,32 80,48 56,55 C 36,61 16,62 8,60 Z" fill="rgba(255, 255, 255, 0.32)" />
            <path d="M 22,55 C 35,40 50,22 66,18 C 78,15 84,22 82,28 C 80,34 68,44 52,49 C 38,53 28,54 22,55 Z" fill="rgba(255, 255, 255, 0.45)" />
            <path d="M 5,65 C 15,75 32,96 54,112 C 66,121 80,128 86,124 C 92,120 90,110 82,98 C 76,90 78,86 84,84 C 90,82 88,74 76,70 C 55,63 22,63 5,65 Z" fill="url(#${gradId}-2)" />
            <path d="M 12,68 C 24,78 42,96 58,106 C 70,114 78,116 80,112 C 82,106 76,96 70,88 C 55,72 30,67 12,68 Z" fill="rgba(255, 255, 255, 0.35)" />
        </svg>
    `;
}

function spawnSingleButterfly(container, options = {}) {
    const uid = ++globalButterflySeq;
    const theme = BUTTERFLY_THEMES[Math.floor(Math.random() * BUTTERFLY_THEMES.length)];
    const isSpecial = options.isSpecial || false;

    const size = isSpecial 
        ? (52 + Math.random() * 20) 
        : (36 + Math.random() * 24);
    
    const startX = options.startX !== undefined 
        ? options.startX 
        : (window.innerWidth * (0.05 + Math.random() * 0.9));
    
    const duration = 4.2 + Math.random() * 2.0;
    const delay = options.delay !== undefined ? options.delay : 0;
    const flapSpeed = 0.16 + Math.random() * 0.09;
    const swayDur = 1.4 + Math.random() * 0.8;
    const colorDur = 3.5 + Math.random() * 2.5;

    const d1 = (Math.random() - 0.5) * 120;
    const d2 = (Math.random() - 0.5) * 180;
    const d3 = (Math.random() - 0.5) * 220;
    const d4 = (Math.random() - 0.5) * 260;
    const baseAngle = (Math.random() - 0.5) * 20;

    const flightEl = document.createElement('div');
    flightEl.className = 'butterfly-flight';
    flightEl.style.setProperty('--start-x', `${startX}px`);
    flightEl.style.setProperty('--size', `${size}px`);
    flightEl.style.setProperty('--fly-duration', `${duration}s`);
    flightEl.style.setProperty('--fly-delay', `${delay}s`);
    flightEl.style.setProperty('--drift-x1', `${d1}px`);
    flightEl.style.setProperty('--drift-x2', `${d2}px`);
    flightEl.style.setProperty('--drift-x3', `${d3}px`);
    flightEl.style.setProperty('--drift-x4', `${d4}px`);

    const tiltEl = document.createElement('div');
    tiltEl.className = 'butterfly-body-tilt';
    tiltEl.style.setProperty('--sway-duration', `${swayDur}s`);
    tiltEl.style.setProperty('--base-angle', `${baseAngle}deg`);

    const modelEl = document.createElement('div');
    modelEl.className = 'butterfly-model';
    modelEl.style.setProperty('--glow-color', theme.glow);
    modelEl.style.setProperty('--color-cycle-dur', `${colorDur}s`);

    const antennaeEl = document.createElement('div');
    antennaeEl.className = 'butterfly-antennae';
    antennaeEl.innerHTML = `
        <svg viewBox="0 0 24 16" width="100%" height="100%">
            <path d="M 12,14 Q 8,4 3,2 M 12,14 Q 16,4 21,2" stroke="#ffffff" stroke-width="1.2" fill="none" stroke-linecap="round"/>
            <circle cx="3" cy="2" r="1.5" fill="${theme.particleColor}"/>
            <circle cx="21" cy="2" r="1.5" fill="${theme.particleColor}"/>
        </svg>
    `;

    const thoraxEl = document.createElement('div');
    thoraxEl.className = 'butterfly-thorax';

    const gradIdLeft = `bf-grad-${uid}-L`;
    const wingLeft = document.createElement('div');
    wingLeft.className = 'butterfly-wing left';
    wingLeft.style.setProperty('--flap-speed', `${flapSpeed}s`);
    wingLeft.innerHTML = createButterflyLeftWing(theme, gradIdLeft);

    const gradIdRight = `bf-grad-${uid}-R`;
    const wingRight = document.createElement('div');
    wingRight.className = 'butterfly-wing right';
    wingRight.style.setProperty('--flap-speed', `${flapSpeed}s`);
    wingRight.innerHTML = createButterflyRightWing(theme, gradIdRight);

    modelEl.appendChild(antennaeEl);
    modelEl.appendChild(thoraxEl);
    modelEl.appendChild(wingLeft);
    modelEl.appendChild(wingRight);
    tiltEl.appendChild(modelEl);
    flightEl.appendChild(tiltEl);
    container.appendChild(flightEl);

    // 发光鳞粉洒落粒子
    let sparkleTimer = null;
    const startTimestamp = performance.now() + delay * 1000;
    const endTimestamp = startTimestamp + duration * 1000;

    const emitSparkle = () => {
        const now = performance.now();
        if (now >= startTimestamp && now <= endTimestamp) {
            const rect = flightEl.getBoundingClientRect();
            if (rect.top > -50 && rect.top < window.innerHeight + 50) {
                const sparkle = document.createElement('div');
                sparkle.className = 'butterfly-sparkle';
                const pSize = 3 + Math.random() * 5;
                const pDur = 1.0 + Math.random() * 0.8;
                const sx = (Math.random() - 0.5) * 24;
                const sy = 15 + Math.random() * 35;

                sparkle.style.width = `${pSize}px`;
                sparkle.style.height = `${pSize}px`;
                sparkle.style.left = `${rect.left + rect.width / 2}px`;
                sparkle.style.top = `${rect.top + rect.height / 2}px`;
                sparkle.style.setProperty('--sparkle-color', theme.particleColor);
                sparkle.style.setProperty('--sparkle-dur', `${pDur}s`);
                sparkle.style.setProperty('--sx', `${sx}px`);
                sparkle.style.setProperty('--sy', `${sy}px`);

                container.appendChild(sparkle);
                setTimeout(() => sparkle.remove(), pDur * 1000);
            }
        }
        if (now < endTimestamp) {
            sparkleTimer = setTimeout(emitSparkle, 140 + Math.random() * 120);
        }
    };
    sparkleTimer = setTimeout(emitSparkle, delay * 1000);

    const totalLifetime = (delay + duration + 0.5) * 1000;
    setTimeout(() => {
        clearTimeout(sparkleTimer);
        flightEl.remove();
    }, totalLifetime);
}

function createButterflyMissEffect(count) {
    if (prefersReducedMotion()) return;

    // 呼应背景樱花浪漫绽放
    if (typeof window.homeSakuraEffect?.triggerMissYouFlutter === 'function') {
        window.homeSakuraEffect.triggerMissYouFlutter();
    }

    let container = document.getElementById('butterfly-miss-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'butterfly-miss-container';
        document.body.appendChild(container);
    }

    const isMobile = window.innerWidth < 768;
    const defaultCount = isMobile ? 12 : 20;
    const actualCount = count || defaultCount;

    for (let i = 0; i < actualCount; i++) {
        const delay = i * 0.12 + Math.random() * 0.22;
        spawnSingleButterfly(container, {
            delay: delay,
            isSpecial: i === 0 || i === Math.floor(actualCount / 2)
        });
    }

    // 自动清理空容器
    setTimeout(() => {
        if (container && container.childNodes.length === 0) {
            container.remove();
        }
    }, 8000);
}

// 保持对原有调用接口的全面无缝兼容
function createHeartRain() {
    createButterflyMissEffect();
}

window.createButterflyMissEffect = createButterflyMissEffect;


let isSendingMissYou = false;
let missYouRequestGeneration = 0;

function resetMissYouRequestState() {
    missYouRequestGeneration += 1;
    isSendingMissYou = false;
}

async function sendMissYou() {
    if (!currentAuthUser?.id || !currentAuthor) {
        showToast('请先登录再发送想念哦~');
        return;
    }
    if (isSendingMissYou) return;
    isSendingMissYou = true;
    const requestGeneration = ++missYouRequestGeneration;
    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const stillCurrent = () => requestGeneration === missYouRequestGeneration
        && isCurrentAuthSnapshot(epoch, userId);

    try {
        // Play local animation immediately
        createHeartRain();

        const partner = currentAuthor === '小蛇' ? '小奚' : '小蛇';

        const channel = bothOnline ? presenceChannel : null;
        if (channel) {
            try {
                const status = await channel.send({
                    type: 'broadcast',
                    event: 'miss_you',
                    payload: { sender_id: currentAuthUser.id }
                });
                if (!stillCurrent()) return;
                if (status !== 'ok') throw new Error(`Realtime send returned: ${status}`);
                showToast(`💓 已向 ${partner} 发送了实时心电感应！`);
                return;
            } catch (err) {
                if (!stillCurrent()) return;
                console.warn('实时想念发送失败，改为保存通知:', err);
            }
        }

        if (!stillCurrent()) return;
        try {
            // The database derives sender, recipient, and space from auth.uid().
            const { error } = await supabaseClient.rpc('send_miss_you');
            if (!stillCurrent()) return;
            if (error) throw error;
            showToast(`💓 已将你的思念存入时光信箱，${partner} 上线就能收到！`);
        } catch (err) {
            if (!stillCurrent()) return;
            console.error('发送想念失败:', err);
            showToast('思念发送失败，请检查网络后再试~');
        }
    } finally {
        if (requestGeneration === missYouRequestGeneration) isSendingMissYou = false;
    }
}

// --- 星光粒子 ---
function createStarField() {
    const field = document.getElementById('star-field');
    if (!field) return;
    field.replaceChildren();
    if (prefersReducedMotion()) return;
    const count = window.innerWidth < 768 ? 8 : 14;
    for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.setProperty('--duration', (2.5 + Math.random() * 3.5) + 's');
        star.style.animationDelay = Math.random() * 3 + 's';
        const size = (1 + Math.random() * 1.8) + 'px';
        star.style.width = size;
        star.style.height = size;
        field.appendChild(star);
    }
}

// --- 滚动入场快速就绪 ---
function initScrollReveal() {
    document.querySelectorAll('.moment-card:not(.visible)').forEach(card => {
        card.classList.add('visible');
    });
}

// --- 爱心与甜美粒子 ---
let lastSpawnHeartTime = 0;
const MAX_ACTIVE_LOVE_PARTICLES = 6;

function spawnHearts(x, y) {
    if (prefersReducedMotion()) return;
    const now = Date.now();
    if (now - lastSpawnHeartTime < 120) return;
    lastSpawnHeartTime = now;

    const currentParticles = document.querySelectorAll('.love-particle');
    if (currentParticles.length >= MAX_ACTIVE_LOVE_PARTICLES) return;

    const hearts = ['💖', '🌸', '✨', '🎀', '🍬', '🍓', '💕', '🧁', '💗', '⭐', '❀'];
    const count = Math.min(2, MAX_ACTIVE_LOVE_PARTICLES - currentParticles.length);
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'love-particle';
        particle.textContent = hearts[Math.floor(Math.random() * hearts.length)];
        const tx = (Math.random() - 0.5) * 110;
        const ty = -(40 + Math.random() * 70);
        const rot = (Math.random() - 0.5) * 80;
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.setProperty('--tx', tx + 'px');
        particle.style.setProperty('--ty', ty + 'px');
        particle.style.setProperty('--rot', rot + 'deg');
        particle.style.fontSize = (15 + Math.random() * 8) + 'px';
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 1100);
    }
}
// --- 卡片跟随光晕 (仅电脑端生效，移动端跳过，RAF 节流 + GPU 合成层 translate3d) ---
function isMobileClient() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
        || (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
}

function initCardGlow() {
    // 手机端直接跳过，零开销
    if (isMobileClient()) return;

    document.querySelectorAll('.anniv-card, .timer-card').forEach(card => {
        if (card.querySelector('.glow')) return;
        const glow = document.createElement('div');
        glow.className = 'glow';
        card.appendChild(glow);
        let rect = null;
        let rafId = null;
        card.addEventListener('mouseenter', () => {
            rect = card.getBoundingClientRect();
        }, { passive: true });
        card.addEventListener('mousemove', (e) => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                if (!rect) rect = card.getBoundingClientRect();
                glow.style.transform = `translate3d(${e.clientX - rect.left}px, ${e.clientY - rect.top}px, 0) translate(-50%, -50%)`;
            });
        }, { passive: true });
        card.addEventListener('mouseleave', () => {
            rect = null;
            if (rafId) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
        }, { passive: true });
    });
}

// 自动尝试初始化一次已有卡片（如 timer-card）
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardGlow, { once: true });
} else {
    initCardGlow();
}
let lastGlobalClickParticleTime = 0;
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !bell.contains(e.target)) {
        panel.classList.remove('show');
    }
    
    if (e.target.closest('button, a, input, textarea, select, .modal-overlay, audio, .fab-container, .notification-panel, [role="button"]')) return;
    
    const now = performance.now();
    if (now - lastGlobalClickParticleTime < 180) return;
    lastGlobalClickParticleTime = now;

    spawnHearts(e.clientX, e.clientY);
    if (typeof window.homeSakuraEffect?.createBurst === 'function') {
        const count = typeof isMobileClient === 'function' && isMobileClient() ? 6 : 10;
        window.homeSakuraEffect.createBurst(e.clientX, e.clientY, count);
    }
});

