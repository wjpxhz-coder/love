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
            top: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(-20px);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            pointer-events: none;
            transition: all 0.45s cubic-bezier(0.25, 1, 0.5, 1);
        `;
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.style.cssText = `
        background: rgba(255, 255, 255, 0.9);
        color: var(--primary);
        padding: 10px 20px;
        border-radius: 20px;
        box-shadow: 0 4px 15px rgba(212, 107, 122, 0.2);
        font-weight: 600;
        font-size: 0.9em;
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
        border: 1px solid rgba(212, 107, 122, 0.15);
    `;
    
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark') {
        toast.style.background = 'rgba(30, 30, 30, 0.9)';
        toast.style.color = '#ff9a9e';
        toast.style.borderColor = 'rgba(255, 154, 158, 0.15)';
    }

    toast.innerText = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
    }, 10);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, duration);
}

function createHeartRain() {
    if (prefersReducedMotion()) return;
    const heartCount = 24;
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
    
    const hearts = ['❤️', '💖', '💝', '💓', '💕', '💗'];
    
    for (let i = 0; i < heartCount; i++) {
        const heart = document.createElement('div');
        const emoji = hearts[Math.floor(Math.random() * hearts.length)];
        heart.innerText = emoji;
        
        const startLeft = Math.random() * 100;
        const size = 16 + Math.random() * 20;
        const duration = 2 + Math.random() * 2.5;
        const delay = Math.random() * 1.5;
        
        heart.style.cssText = `
            position: absolute;
            top: -50px;
            left: ${startLeft}vw;
            font-size: ${size}px;
            opacity: 0;
            transform: translateY(0) rotate(0deg);
            animation: fallAndSway ${duration}s linear ${delay}s forwards;
            user-select: none;
        `;
        container.appendChild(heart);
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
    const count = window.innerWidth < 768 ? 12 : 25;
    for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = Math.random() * 100 + '%';
        star.style.top = Math.random() * 100 + '%';
        star.style.setProperty('--duration', (2 + Math.random() * 4) + 's');
        star.style.animationDelay = Math.random() * 4 + 's';
        const size = (1 + Math.random() * 2) + 'px';
        star.style.width = size;
        star.style.height = size;
        field.appendChild(star);
    }
}

// --- 滚动入场观察器 ---
function initScrollReveal() {
    if (prefersReducedMotion()) {
        document.querySelectorAll('.moment-card:not(.visible)').forEach(card => card.classList.add('visible'));
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, index * 80);
                observer.unobserve(entry.target);
            }
        });
    }, { rootMargin: '0px 0px -30px 0px', threshold: 0.05 });
    document.querySelectorAll('.moment-card:not(.visible)').forEach(card => {
        observer.observe(card);
    });
}

// --- 爱心粒子 ---
function spawnHearts(x, y) {
    if (prefersReducedMotion()) return;
    const hearts = ['💕', '💖', '💗', '✨', '🌸', '💘'];
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'love-particle';
        particle.textContent = hearts[Math.floor(Math.random() * hearts.length)];
        const tx = (Math.random() - 0.5) * 120;
        const ty = -(40 + Math.random() * 80);
        const rot = (Math.random() - 0.5) * 90;
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.setProperty('--tx', tx + 'px');
        particle.style.setProperty('--ty', ty + 'px');
        particle.style.setProperty('--rot', rot + 'deg');
        particle.style.fontSize = (14 + Math.random() * 10) + 'px';
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 1300);
    }
}
// --- 纪念日卡片光晕 ---
function initCardGlow() {
    document.querySelectorAll('.anniv-card').forEach(card => {
        if (card.querySelector('.glow')) return;
        const glow = document.createElement('div');
        glow.className = 'glow';
        card.appendChild(glow);
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            glow.style.left = (e.clientX - rect.left) + 'px';
            glow.style.top = (e.clientY - rect.top) + 'px';
        });
    });
}
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !bell.contains(e.target)) {
        panel.classList.remove('show');
    }
    
    if (e.target.closest('button, a, input, textarea, select, .modal-overlay, audio, .fab-container, .notification-panel')) return;
    spawnHearts(e.clientX, e.clientY);
});
