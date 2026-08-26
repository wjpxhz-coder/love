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
            top: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            transition: all 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
        `;
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: var(--primary);
        padding: 11px 24px;
        border-radius: 24px;
        box-shadow: 0 8px 30px var(--shadow-hover), inset 0 1.5px 1px var(--glass-highlight);
        font-weight: 600;
        font-size: 0.92em;
        letter-spacing: 0.5px;
        opacity: 0;
        transform: translateY(-12px) scale(0.92);
        transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        border: 1.5px solid var(--border);
    `;
    
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') {
        toast.style.background = 'rgba(38, 22, 54, 0.85)';
        toast.style.color = '#ff8fab';
        toast.style.borderColor = 'rgba(255, 143, 171, 0.3)';
    }

    toast.innerText = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0) scale(1)';
    }, 10);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px) scale(0.92)';
        setTimeout(() => {
            toast.remove();
        }, 350);
    }, duration);
}

function createHeartRain() {
    if (prefersReducedMotion()) return;

    // 触发全屏桃花雨急落与中心花瓣浪漫绽放
    if (typeof window.homeSakuraEffect?.triggerMissYouFlutter === 'function') {
        window.homeSakuraEffect.triggerMissYouFlutter();
    }

    const isMobile = window.innerWidth < 768;
    const heartCount = isMobile ? 18 : 32;
    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100dvh;
        pointer-events: none;
        z-index: 9998;
        overflow: hidden;
    `;
    document.body.appendChild(container);
    
    const elements = ['🌸', '💖', '✨', '🎀', '🍬', '🍓', '💕', '🧁', '💗', '❀', '💫', '🌷', '💝'];
    
    for (let i = 0; i < heartCount; i++) {
        const item = document.createElement('div');
        const icon = elements[Math.floor(Math.random() * elements.length)];
        item.innerText = icon;
        
        const startLeft = Math.random() * 100;
        const size = 16 + Math.random() * 18;
        const duration = 2.2 + Math.random() * 1.8;
        const delay = Math.random() * 0.9;
        const swayX = (Math.random() - 0.5) * 90;
        const rotEnd = (Math.random() > 0.5 ? 1 : -1) * (180 + Math.random() * 260);
        
        item.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            --start-x: ${startLeft}vw;
            --sway-x: ${swayX}px;
            --rot-end: ${rotEnd}deg;
            font-size: ${size}px;
            opacity: 0;
            will-change: transform, opacity;
            animation: fallAndSway ${duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${delay}s forwards;
            user-select: none;
            text-shadow: 0 2px 10px rgba(255, 105, 135, 0.4);
        `;
        container.appendChild(item);
    }
    
    setTimeout(() => {
        container.remove();
    }, 5000);
}

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
// --- 纪念日卡片光晕 (RAF 节流 + GPU 合成层 translate3d) ---
function initCardGlow() {
    document.querySelectorAll('.anniv-card').forEach(card => {
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
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !bell.contains(e.target)) {
        panel.classList.remove('show');
    }
    
    if (e.target.closest('button, a, input, textarea, select, .modal-overlay, audio, .fab-container, .notification-panel, [role="button"]')) return;
    spawnHearts(e.clientX, e.clientY);
    if (typeof window.homeSakuraEffect?.createBurst === 'function') {
        window.homeSakuraEffect.createBurst(e.clientX, e.clientY, 14);
    }
});

