// ==========================================================================
// 现代高光仪式特效、Toast 与微交互引擎 (js/effects.js)
// - 按需挂载的纯 Canvas 琉璃流光蝴蝶仪式层（演完自动销毁，平时 0 常驻开销）
// - 零内联冗余样式的现代 Toast 提示
// - 纯 CSS 变量事件委托版卡片漫反射聚光 (Border Spotlight)
// - 点击空白处统一走 Canvas 光学微涟漪，彻底告别 DOM Emoji 粒子
// ==========================================================================

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function getCurrentAmbientMode() {
    const attr = document.documentElement.getAttribute('data-ambient');
    if (attr === 'dream' || attr === 'light' || attr === 'calm') return attr;
    return 'dream';
}

// ==========================================
// 0. 全局滚动锁定与滚动条宽度补偿协议（多浮层引用计数，桌面端 0px 横跳）
// ==========================================
const activeScrollLocks = new Set();

function lockBodyScroll(reason = 'modal') {
    const key = String(reason || 'modal');
    if (activeScrollLocks.size === 0 && !document.body.classList.contains('app-page-active')) {
        const sbWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        document.documentElement.style.setProperty('--app-scrollbar-comp', `${sbWidth}px`);
    }
    activeScrollLocks.add(key);
    document.body.classList.add('is-scroll-locked');
}

function unlockBodyScroll(reason = 'modal') {
    const key = String(reason || 'modal');
    activeScrollLocks.delete(key);
    if (activeScrollLocks.size === 0) {
        document.body.classList.remove('is-scroll-locked');
        if (!document.body.classList.contains('app-page-active')) {
            document.documentElement.style.setProperty('--app-scrollbar-comp', '0px');
        }
    }
}

window.lockBodyScroll = lockBodyScroll;
window.unlockBodyScroll = unlockBodyScroll;

// ==========================================
// 1. 现代 Top Layer Toast 提示（支持 popover="manual" 浮于所有 <dialog> 之上）
// ==========================================
function promoteToastLayer() {
    const container = document.getElementById('toast-container');
    if (!container || typeof container.showPopover !== 'function') return;
    try {
        if (container.matches?.(':popover-open')) {
            container.hidePopover();
        }
        container.showPopover();
    } catch (_e) {}
}
window.promoteToastLayer = promoteToastLayer;

function showToast(message, duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        if ('popover' in HTMLElement.prototype) {
            container.setAttribute('popover', 'manual');
        }
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        container.setAttribute('aria-atomic', 'false');
        document.body.appendChild(container);
    }
    promoteToastLayer();

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.textContent = String(message ?? '');
    container.appendChild(toast);

    // 强制提交初始帧布局，杜绝首次挂载同帧合并吞动画
    void toast.offsetWidth;
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        setTimeout(() => {
            toast.remove();
            if (container.childElementCount === 0) {
                try {
                    if (typeof container.hidePopover === 'function' && container.matches?.(':popover-open')) {
                        container.hidePopover();
                    }
                } catch (_e) {}
                container.remove();
            }
        }, 260);
    }, duration);
}

// ==========================================
// 1.5 全局统一轻奢毛玻璃确认弹窗（替代冰冷的原生 window.confirm）
// ==========================================
let activeConfirmResolver = null;
let confirmDialogCloseTimer = null;
let confirmDialogPendingFinalize = null;

function showConfirmDialog(message, options = {}) {
    const {
        title = '温柔确认 ✨',
        confirmText = '确认',
        cancelText = '取消',
        danger = false
    } = options || {};

    // 若上一个确认框尚未关闭，先立即同步结算为 false
    if (activeConfirmResolver) {
        const prev = activeConfirmResolver;
        activeConfirmResolver = null;
        prev(false, true);
    }

    // 若上一轮确认框正处于 220ms 退场动画窗口期，立即取消残留定时器并同步完成底层 close()
    if (confirmDialogCloseTimer) {
        clearTimeout(confirmDialogCloseTimer);
        confirmDialogCloseTimer = null;
    }
    if (confirmDialogPendingFinalize) {
        const finalizePrev = confirmDialogPendingFinalize;
        confirmDialogPendingFinalize = null;
        finalizePrev();
    }

    return new Promise((resolve) => {
        let dialog = document.getElementById('globalConfirmDialog');
        if (!dialog) {
            dialog = document.createElement('dialog');
            dialog.id = 'globalConfirmDialog';
            dialog.className = 'native-dialog confirm-modal-dialog';
            dialog.setAttribute('aria-labelledby', 'globalConfirmTitle');
            dialog.setAttribute('aria-describedby', 'globalConfirmMessage');
            dialog.innerHTML = `
                <div class="modal-box confirm-modal-box">
                    <h2 class="modal-title confirm-modal-title" id="globalConfirmTitle"></h2>
                    <div class="confirm-modal-message" id="globalConfirmMessage"></div>
                    <div class="modal-btns confirm-modal-btns">
                        <button type="button" class="btn-cancel confirm-btn-cancel" id="globalConfirmCancelBtn"></button>
                        <button type="button" class="confirm-btn-ok" id="globalConfirmOkBtn"></button>
                    </div>
                </div>
            `;
            document.body.appendChild(dialog);
        }

        const titleEl = dialog.querySelector('#globalConfirmTitle');
        const msgEl = dialog.querySelector('#globalConfirmMessage');
        const cancelBtn = dialog.querySelector('#globalConfirmCancelBtn');
        const okBtn = dialog.querySelector('#globalConfirmOkBtn');

        if (titleEl) titleEl.textContent = title;
        if (msgEl) msgEl.textContent = String(message ?? '');
        if (cancelBtn) cancelBtn.textContent = cancelText;
        if (okBtn) {
            okBtn.textContent = confirmText;
            okBtn.classList.toggle('is-danger', Boolean(danger));
        }

        let settled = false;
        const previousFocus = document.activeElement;

        const settle = (result, immediate = false) => {
            if (settled) return;
            settled = true;
            if (activeConfirmResolver === settle) {
                activeConfirmResolver = null;
            }
            dialog.removeEventListener('click', onBackdropClick);
            dialog.removeEventListener('cancel', onCancel);
            dialog.removeEventListener('close', onNativeClose);
            okBtn?.removeEventListener('click', onConfirmClick);
            cancelBtn?.removeEventListener('click', onCancelClick);

            let finalized = false;
            const finalizeClose = () => {
                if (finalized) return;
                finalized = true;
                if (confirmDialogPendingFinalize === finalizeClose) {
                    confirmDialogPendingFinalize = null;
                }
                dialog.classList.remove('is-open', 'is-closing');
                try {
                    if (dialog.open) dialog.close();
                } catch (_e) {
                    dialog.removeAttribute('open');
                }
                unlockBodyScroll('confirm-dialog');
                window.suspendAllAmbientEffects?.(false, 'confirm-dialog');
                if (!immediate && previousFocus && typeof previousFocus.focus === 'function') {
                    try { previousFocus.focus({ preventScroll: true }); } catch (_err) {}
                }
                resolve(Boolean(result));
            };

            if (immediate || prefersReducedMotion() || !dialog.open) {
                finalizeClose();
                return;
            }
            dialog.classList.remove('is-open');
            dialog.classList.add('is-closing');
            confirmDialogPendingFinalize = finalizeClose;
            confirmDialogCloseTimer = setTimeout(() => {
                confirmDialogCloseTimer = null;
                finalizeClose();
            }, 220);
        };

        activeConfirmResolver = settle;

        const onConfirmClick = () => settle(true);
        const onCancelClick = () => settle(false);
        const onBackdropClick = (e) => {
            if (e.target === dialog) settle(false);
        };
        const onCancel = (e) => {
            e.preventDefault();
            settle(false);
        };
        const onNativeClose = () => {
            settle(false, true);
        };

        okBtn?.addEventListener('click', onConfirmClick);
        cancelBtn?.addEventListener('click', onCancelClick);
        dialog.addEventListener('click', onBackdropClick);
        dialog.addEventListener('cancel', onCancel);
        dialog.addEventListener('close', onNativeClose);

        dialog.classList.remove('is-closing');
        lockBodyScroll('confirm-dialog');
        window.suspendAllAmbientEffects?.(true, 'confirm-dialog');
        try {
            if (!dialog.open && typeof dialog.showModal === 'function') {
                dialog.showModal();
            } else {
                dialog.setAttribute('open', '');
            }
        } catch (_e) {
            dialog.setAttribute('open', '');
        }
        promoteToastLayer();

        if (prefersReducedMotion()) {
            dialog.classList.add('is-open');
        } else {
            dialog.classList.remove('is-open');
            void dialog.offsetWidth;
            requestAnimationFrame(() => {
                if (dialog.open && !dialog.classList.contains('is-closing')) {
                    dialog.classList.add('is-open');
                }
            });
        }

        requestAnimationFrame(() => {
            (danger ? cancelBtn : okBtn)?.focus?.({ preventScroll: true });
        });
    });
}
window.showConfirmDialog = showConfirmDialog;

// ==========================================
// 2. 🦋 现代高光仪式层：纯 Canvas 琉璃流光蝴蝶群
//    - 法式香槟玫瑰 / 暮光星紫 / 晨曦珠光 / 暖金流霞 四套轻奢羽翼
//    - 离屏预烘焙单翼纹理（零实时 drop-shadow、零 DOM 合成层爆炸）
//    - 切线朝向跟随 + 透视振翅 + 光学鳞粉星尘拖尾
//    - 演出完毕自动注销 rAF 并移除 Canvas，回归 0 内存/0 GPU 占用
// ==========================================
const CEREMONY_BUTTERFLY_PALETTES = [
    {
        name: 'rose-champagne',
        glow: 'rgba(244, 114, 182, 0.55)',
        upper: ['#fff5f7', '#fda4af', '#f43f5e'],
        lower: ['#ffe4e6', '#fb7185', '#e11d48'],
        vein: 'rgba(255, 255, 255, 0.72)',
        spark: '#fecdd3'
    },
    {
        name: 'moonlight-violet',
        glow: 'rgba(192, 132, 252, 0.55)',
        upper: ['#faf5ff', '#d8b4fe', '#a855f7'],
        lower: ['#f3e8ff', '#c084fc', '#9333ea'],
        vein: 'rgba(255, 255, 255, 0.72)',
        spark: '#e9d5ff'
    },
    {
        name: 'dawn-sakura',
        glow: 'rgba(251, 146, 178, 0.55)',
        upper: ['#ffffff', '#fbcfe8', '#ec4899'],
        lower: ['#fdf2f8', '#f9a8d4', '#db2777'],
        vein: 'rgba(255, 255, 255, 0.78)',
        spark: '#fce7f3'
    },
    {
        name: 'golden-sunset',
        glow: 'rgba(251, 191, 36, 0.55)',
        upper: ['#fffbeb', '#fde68a', '#f59e0b'],
        lower: ['#fef3c7', '#fbbf24', '#f43f5e'],
        vein: 'rgba(255, 255, 255, 0.75)',
        spark: '#fef08a'
    }
];

const ceremonyWingCache = new Map();

function getCeremonyWingSprite(palette) {
    if (ceremonyWingCache.has(palette.name)) {
        return ceremonyWingCache.get(palette.name);
    }

    // 预烘焙单侧左翼（右翼绘制时通过 scaleX(-1) 镜像复用），含柔和外光晕
    const W = 96;
    const H = 128;
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { canvas, width: W, height: H };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 预烘焙柔光底晕（完全取代昂贵的实时 filter: drop-shadow）
    const aura = ctx.createRadialGradient(W * 0.56, H * 0.48, 4, W * 0.56, H * 0.48, 52);
    aura.addColorStop(0, palette.glow);
    aura.addColorStop(0.55, palette.glow.replace('0.55', '0.16'));
    aura.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(W * 0.56, H * 0.48, 52, 0, Math.PI * 2);
    ctx.fill();

    // 坐标映射：翅根贴近画布右侧中线 (x = W - 6, y = H * 0.5)
    ctx.save();
    ctx.translate(W - 6, H * 0.5);

    // 上主翼（琉璃感渐变）
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.bezierCurveTo(-4, -22, -26, -50, -56, -56);
    ctx.bezierCurveTo(-78, -60, -86, -44, -80, -26);
    ctx.bezierCurveTo(-72, -6, -42, 4, 0, 2);
    ctx.closePath();

    const g1 = ctx.createLinearGradient(-78, -54, 0, 4);
    g1.addColorStop(0, palette.upper[0]);
    g1.addColorStop(0.45, palette.upper[1]);
    g1.addColorStop(1, palette.upper[2]);
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = g1;
    ctx.fill();

    // 上翼内部通透丝绸高光层
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.bezierCurveTo(-18, -22, -38, -40, -58, -42);
    ctx.bezierCurveTo(-68, -43, -70, -32, -60, -20);
    ctx.bezierCurveTo(-46, -6, -24, -2, -6, -4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    ctx.fill();

    // 下尾翼（轻柔拖摆）
    ctx.beginPath();
    ctx.moveTo(0, 2);
    ctx.bezierCurveTo(-14, 14, -36, 36, -54, 48);
    ctx.bezierCurveTo(-66, 56, -74, 50, -70, 38);
    ctx.bezierCurveTo(-66, 28, -58, 22, -62, 16);
    ctx.bezierCurveTo(-64, 10, -44, 2, 0, 2);
    ctx.closePath();

    const g2 = ctx.createLinearGradient(-68, 46, 0, 2);
    g2.addColorStop(0, palette.lower[0]);
    g2.addColorStop(0.5, palette.lower[1]);
    g2.addColorStop(1, palette.lower[2]);
    ctx.globalAlpha = 0.86;
    ctx.fillStyle = g2;
    ctx.fill();

    // 精致珠光翅脉
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = palette.vein;
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, -2);
    ctx.quadraticCurveTo(-34, -28, -68, -36);
    ctx.moveTo(-2, 0);
    ctx.quadraticCurveTo(-32, -10, -64, -14);
    ctx.moveTo(-2, 3);
    ctx.quadraticCurveTo(-28, 22, -56, 36);
    ctx.stroke();

    // 翅尖微光珠点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(-66, -37, 2.1, 0, Math.PI * 2);
    ctx.arc(-57, 36, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    const sprite = { canvas, width: W, height: H };
    ceremonyWingCache.set(palette.name, sprite);
    return sprite;
}

const ceremonyState = {
    layer: null,
    canvas: null,
    ctx: null,
    width: 0,
    height: 0,
    dpr: 1,
    rafId: null,
    lastTimestamp: 0,
    butterflies: [],
    sparks: [],
    resizeHandler: null,
    visibilityHandler: null,
    glowTimer: null,
    lastTriggerTime: 0
};

function mountCeremonyCanvas() {
    if (ceremonyState.canvas && ceremonyState.ctx) {
        if (ceremonyState.layer && typeof ceremonyState.layer.showPopover === 'function') {
            try {
                if (ceremonyState.layer.matches?.(':popover-open')) {
                    ceremonyState.layer.hidePopover();
                }
                ceremonyState.layer.showPopover();
            } catch (_e) {}
            promoteToastLayer();
        }
        return true;
    }

    const layer = document.createElement('div');
    layer.id = 'ceremony-layer';
    layer.setAttribute('aria-hidden', 'true');
    if ('popover' in HTMLElement.prototype) {
        layer.setAttribute('popover', 'manual');
    }

    const canvas = document.createElement('canvas');
    canvas.id = 'ceremony-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return false;

    layer.appendChild(canvas);

    const resize = () => {
        const w = Math.max(window.innerWidth, 1);
        const h = Math.max(window.innerHeight, 1);
        const isMobile = w < 768;
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), isMobile ? 1.25 : 1.5);
        ceremonyState.width = w;
        ceremonyState.height = h;
        ceremonyState.dpr = dpr;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
    };

    const onVisibility = () => {
        if (document.hidden) {
            unmountCeremonyCanvas();
        }
    };

    document.body.appendChild(layer);
    if (typeof layer.showPopover === 'function') {
        try { layer.showPopover(); } catch (_e) {}
        promoteToastLayer();
    }

    ceremonyState.layer = layer;
    ceremonyState.canvas = canvas;
    ceremonyState.ctx = ctx;
    ceremonyState.resizeHandler = resize;
    ceremonyState.visibilityHandler = onVisibility;
    resize();

    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return true;
}

function unmountCeremonyCanvas() {
    if (ceremonyState.rafId !== null) {
        cancelAnimationFrame(ceremonyState.rafId);
        ceremonyState.rafId = null;
    }
    if (ceremonyState.glowTimer !== null) {
        clearTimeout(ceremonyState.glowTimer);
        ceremonyState.glowTimer = null;
    }
    ceremonyState.lastTimestamp = 0;
    ceremonyState.butterflies.length = 0;
    ceremonyState.sparks.length = 0;

    if (ceremonyState.resizeHandler) {
        window.removeEventListener('resize', ceremonyState.resizeHandler);
        ceremonyState.resizeHandler = null;
    }
    if (ceremonyState.visibilityHandler) {
        document.removeEventListener('visibilitychange', ceremonyState.visibilityHandler);
        ceremonyState.visibilityHandler = null;
    }
    if (ceremonyState.layer) {
        try {
            if (typeof ceremonyState.layer.hidePopover === 'function' && ceremonyState.layer.matches?.(':popover-open')) {
                ceremonyState.layer.hidePopover();
            }
        } catch (_e) {}
        ceremonyState.layer.remove();
        ceremonyState.layer = null;
    } else if (ceremonyState.canvas) {
        ceremonyState.canvas.remove();
    }
    ceremonyState.canvas = null;
    ceremonyState.ctx = null;
}

function triggerHorizonGlow() {
    const host = ceremonyState.layer || document.body;
    let glow = host.querySelector('.ceremony-horizon-glow');
    if (!glow) {
        glow = document.createElement('div');
        glow.className = 'ceremony-horizon-glow';
        glow.setAttribute('aria-hidden', 'true');
        host.insertBefore(glow, host.firstChild);
    } else {
        // 平滑重启动画而不直接拔除 DOM 节点造成黑闪
        glow.style.animation = 'none';
        void glow.offsetWidth;
        glow.style.animation = '';
    }
    if (ceremonyState.glowTimer !== null) {
        clearTimeout(ceremonyState.glowTimer);
    }
    ceremonyState.glowTimer = setTimeout(() => {
        ceremonyState.glowTimer = null;
        glow?.remove();
    }, 2800);
}

function spawnCeremonyButterfly(options = {}) {
    const w = ceremonyState.width || window.innerWidth;
    const h = ceremonyState.height || window.innerHeight;
    const isMobile = w < 768;
    const palette = CEREMONY_BUTTERFLY_PALETTES[
        Math.floor(Math.random() * CEREMONY_BUTTERFLY_PALETTES.length)
    ];
    const wingSprite = getCeremonyWingSprite(palette);
    const isHero = Boolean(options.isHero);

    const startX = options.startX !== undefined
        ? options.startX
        : w * (0.10 + Math.random() * 0.80);
    const duration = (isMobile ? 3.8 : 4.4) + Math.random() * 1.4;
    const size = isHero
        ? (isMobile ? 42 : 52) + Math.random() * 12
        : (isMobile ? 28 : 34) + Math.random() * 16;

    ceremonyState.butterflies.push({
        palette,
        wingSprite,
        x: startX,
        y: h + 48 + Math.random() * 32,
        prevX: startX,
        prevY: h + 64,
        baseX: startX,
        age: -(options.delay || 0),
        duration,
        size,
        heading: 0,
        waveFreq1: 1.4 + Math.random() * 1.1,
        waveFreq2: 2.8 + Math.random() * 1.5,
        waveAmp1: (isMobile ? 42 : 76) + Math.random() * (isMobile ? 38 : 72),
        waveAmp2: (isMobile ? 16 : 28) + Math.random() * 22,
        phase1: Math.random() * Math.PI * 2,
        phase2: Math.random() * Math.PI * 2,
        driftX: (Math.random() - 0.5) * (isMobile ? 90 : 180),
        flapPhase: Math.random() * Math.PI * 2,
        flapSpeed: 14 + Math.random() * 6,
        sparkAccum: 0
    });
}

function stepAndRenderCeremony(timestamp) {
    ceremonyState.rafId = null;
    if (!ceremonyState.canvas || !ceremonyState.ctx) return;
    if (prefersReducedMotion()) {
        unmountCeremonyCanvas();
        return;
    }

    if (document.hidden) {
        unmountCeremonyCanvas();
        return;
    }

    const dtSec = ceremonyState.lastTimestamp > 0
        ? Math.min((timestamp - ceremonyState.lastTimestamp) / 1000, 0.05)
        : 0.016;
    ceremonyState.lastTimestamp = timestamp;
    const step = dtSec * 60;

    const { ctx, width, height, dpr, butterflies, sparks } = ceremonyState;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ceremonyState.canvas.width, ceremonyState.canvas.height);

    // 1. 更新并绘制流光鳞粉星尘
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = isDark ? 'lighter' : 'source-over';

    for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx * step;
        sp.y += sp.vy * step;
        sp.vx *= Math.pow(0.96, step);
        sp.vy = sp.vy * Math.pow(0.97, step) + 0.025 * step;
        sp.life -= sp.decay * step;
        if (sp.life <= 0) {
            sparks.splice(i, 1);
            continue;
        }

        const alpha = sp.life * sp.life;
        const r = sp.radius * (0.45 + 0.55 * sp.life);

        // 外柔光晕
        ctx.globalAlpha = alpha * (isDark ? 0.55 : 0.42);
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r * 2.4, 0, Math.PI * 2);
        ctx.fill();

        // 中心珠光亮点
        ctx.globalAlpha = alpha * 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // 2. 更新并绘制琉璃流光蝴蝶
    ctx.globalCompositeOperation = 'source-over';
    const maxSparks = width < 768 ? 90 : 160;

    for (let i = butterflies.length - 1; i >= 0; i--) {
        const bf = butterflies[i];
        bf.age += dtSec;
        if (bf.age < 0) continue;

        const progress = bf.age / bf.duration;
        if (progress >= 1) {
            butterflies.splice(i, 1);
            continue;
        }

        // 平滑加速入场 + 优雅舒缓升空
        const easedY = 1 - Math.pow(1 - progress, 1.55);
        const targetY = (height + 54) - easedY * (height + 165);
        const sway1 = Math.sin(bf.age * bf.waveFreq1 + bf.phase1) * bf.waveAmp1;
        const sway2 = Math.sin(bf.age * bf.waveFreq2 + bf.phase2) * bf.waveAmp2;
        const targetX = bf.baseX + bf.driftX * progress + sway1 + sway2;

        bf.prevX = bf.x;
        bf.prevY = bf.y;
        bf.x = targetX;
        bf.y = targetY;

        // 切线方向平滑跟随（让蝴蝶机身自然转向飞行方向）
        const dx = bf.x - bf.prevX;
        const dy = bf.y - bf.prevY;
        if (dx * dx + dy * dy > 0.04) {
            const desiredHeading = Math.atan2(dy, dx) + Math.PI / 2;
            const clampedHeading = Math.max(-0.68, Math.min(0.68, desiredHeading));
            bf.heading += (clampedHeading - bf.heading) * Math.min(1, dtSec * 8);
        }

        bf.flapPhase += bf.flapSpeed * dtSec;
        const flapCos = Math.cos(bf.flapPhase);
        const wingScaleX = 0.22 + Math.abs(flapCos) * 0.78;
        // 振翅时轻微上下浮力呼吸
        const flapLift = flapCos * 2.2;

        // 入场/离场平滑透明度与比例
        let alpha = 1;
        let scalePop = 1;
        if (progress < 0.1) {
            alpha = progress / 0.1;
            scalePop = 0.55 + 0.45 * (progress / 0.1);
        } else if (progress > 0.84) {
            alpha = Math.max(0, (1 - progress) / 0.16);
            scalePop = 0.88 + 0.12 * alpha;
        }

        // 沿飞行轨迹按节拍洒下流光星尘
        bf.sparkAccum += dtSec;
        if (bf.sparkAccum >= 0.065 && sparks.length < maxSparks && progress > 0.04 && progress < 0.90) {
            bf.sparkAccum = 0;
            sparks.push({
                x: bf.x + (Math.random() - 0.5) * bf.size * 0.45,
                y: bf.y + bf.size * 0.18 + (Math.random() - 0.5) * 8,
                vx: (Math.random() - 0.5) * 0.65 - dx * 0.08,
                vy: 0.45 + Math.random() * 0.85,
                radius: 1.3 + Math.random() * 1.8,
                color: bf.palette.spark,
                life: 1.0,
                decay: 0.018 + Math.random() * 0.014
            });
        }

        // 绘制双翼（矩阵复用离屏单翼贴图，零实时阴影重算）
        const drawScale = (bf.size * scalePop) / 96;
        const sprite = bf.wingSprite;
        const anchorX = sprite.width - 6;
        const anchorY = sprite.height * 0.5;

        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(bf.x, bf.y + flapLift);
        ctx.rotate(bf.heading);
        ctx.globalAlpha = alpha;

        // 左翼
        ctx.save();
        ctx.scale(wingScaleX * drawScale, drawScale);
        ctx.drawImage(sprite.canvas, -anchorX, -anchorY, sprite.width, sprite.height);
        ctx.restore();

        // 右翼（水平镜像）
        ctx.save();
        ctx.scale(-wingScaleX * drawScale, drawScale);
        ctx.drawImage(sprite.canvas, -anchorX, -anchorY, sprite.width, sprite.height);
        ctx.restore();

        // 精致珠光蝶身与触须
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = alpha * 0.95;
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(1.3, bf.size * 0.032), bf.size * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.88)';
        ctx.lineWidth = Math.max(0.9, bf.size * 0.02);
        ctx.lineCap = 'round';
        const antY = -bf.size * 0.2;
        ctx.beginPath();
        ctx.moveTo(0, antY);
        ctx.quadraticCurveTo(-bf.size * 0.08, antY - bf.size * 0.14, -bf.size * 0.15, antY - bf.size * 0.16);
        ctx.moveTo(0, antY);
        ctx.quadraticCurveTo(bf.size * 0.08, antY - bf.size * 0.14, bf.size * 0.15, antY - bf.size * 0.16);
        ctx.stroke();

        ctx.restore();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 全部蝴蝶与尾迹星尘演完后立刻彻底销毁画布，回到 0 占用
    if (butterflies.length === 0 && sparks.length === 0) {
        unmountCeremonyCanvas();
        return;
    }

    ceremonyState.rafId = requestAnimationFrame(stepAndRenderCeremony);
}

function createButterflyMissEffect(count) {
    if (prefersReducedMotion()) return;

    const now = performance.now();
    const isMobile = window.innerWidth < 768;
    const isCalm = getCurrentAmbientMode() === 'calm';
    const maxActive = isCalm ? 4 : (isMobile ? 8 : 12);

    if (ceremonyState.butterflies.length >= maxActive) {
        return;
    }

    if (!mountCeremonyCanvas()) return;

    // 短期防连击过载：1.2 秒内追加 2 只轻盈伴飞蝴蝶
    if (now - ceremonyState.lastTriggerTime < 1200 && ceremonyState.butterflies.length > 0) {
        const extra = Math.min(2, maxActive - ceremonyState.butterflies.length);
        for (let i = 0; i < extra; i++) {
            spawnCeremonyButterfly({ delay: i * 0.16, isHero: false });
        }
    } else {
        ceremonyState.lastTriggerTime = now;

        if (!isCalm) {
            triggerHorizonGlow();
        }
        // 呼应首页背景景深画布轻柔绽放
        if (typeof window.homeSakuraEffect?.triggerMissYouFlutter === 'function') {
            window.homeSakuraEffect.triggerMissYouFlutter();
        }

        const defaultCount = isCalm ? 4 : (isMobile ? 6 : 9);
        const actualCount = Math.min(count || defaultCount, maxActive - ceremonyState.butterflies.length);

        for (let i = 0; i < actualCount; i++) {
            spawnCeremonyButterfly({
                delay: i * 0.15 + Math.random() * 0.16,
                isHero: i === 0 || i === Math.floor(actualCount / 2)
            });
        }
    }

    if (ceremonyState.rafId === null) {
        ceremonyState.lastTimestamp = 0;
        ceremonyState.rafId = requestAnimationFrame(stepAndRenderCeremony);
    }
}

// 保持对全站原有调用接口（presence.js / mood.js / app.js / notifications.js）完全兼容
function createHeartRain() {
    createButterflyMissEffect();
}

window.createButterflyMissEffect = createButterflyMissEffect;

// ==========================================
// 3. 一键想你实时发送逻辑（完整保留）
// ==========================================
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

// ==========================================
// 4. 兼容性占位 & 统一光学交互反馈
// ==========================================
function createStarField() {
    // 远景星尘已统一整合至现代单层景深 Canvas 引擎，不再创建 14 个独立 DOM 合成层
    const field = document.getElementById('star-field');
    if (field) field.replaceChildren();
}

function initScrollReveal() {
    document.querySelectorAll('.moment-card:not(.visible)').forEach(card => {
        card.classList.add('visible');
    });
}

let lastSpawnRippleTime = 0;

function spawnHearts(x, y) {
    if (prefersReducedMotion()) return;
    const mode = getCurrentAmbientMode();
    if (mode === 'calm') return;
    const now = performance.now();
    if (now - lastSpawnRippleTime < 180) return;
    lastSpawnRippleTime = now;

    if (typeof window.homeSakuraEffect?.createBurst === 'function') {
        const isMobile = isMobileClient();
        const count = mode === 'light'
            ? (isMobile ? 5 : 6)
            : (isMobile ? 8 : 11);
        window.homeSakuraEffect.createBurst(x, y, count);
    }
}

// ==========================================
// 5. 现代卡片漫反射聚光（事件委托 + CSS 变量，零额外 .glow DOM）
// ==========================================
function isMobileClient() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
        || (window.innerWidth <= 768 && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
}

let spotlightInitialized = false;

function initCardGlow() {
    if (spotlightInitialized || isMobileClient()) return;
    if (window.matchMedia && !window.matchMedia('(any-hover: hover) and (any-pointer: fine)').matches) {
        return;
    }
    spotlightInitialized = true;

    const SPOTLIGHT_SELECTOR = '.timer-card, .anniv-card, .home-topic-card';
    let activeCard = null;
    let activeRect = null;
    let pendingX = 0;
    let pendingY = 0;
    let rafId = null;

    document.addEventListener('pointermove', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (getCurrentAmbientMode() === 'calm' || prefersReducedMotion()) return;

        const card = e.target?.closest?.(SPOTLIGHT_SELECTOR);
        if (!card) {
            activeCard = null;
            activeRect = null;
            return;
        }
        if (card !== activeCard) {
            activeCard = card;
            activeRect = card.getBoundingClientRect();
        }
        pendingX = e.clientX;
        pendingY = e.clientY;
        if (rafId !== null) return;

        rafId = requestAnimationFrame(() => {
            rafId = null;
            if (!activeCard || !activeRect) return;
            activeCard.style.setProperty('--spot-x', `${Math.round(pendingX - activeRect.left)}px`);
            activeCard.style.setProperty('--spot-y', `${Math.round(pendingY - activeRect.top)}px`);
        });
    }, { passive: true });

    window.addEventListener('scroll', () => {
        activeRect = null;
    }, { passive: true });

    window.addEventListener('resize', () => {
        activeRect = null;
    }, { passive: true });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardGlow, { once: true });
} else {
    initCardGlow();
}

// ==========================================
// 6. 全局点击与 Escape 监听（收起通知面板/FAB 菜单 + 空白处克制光学微涟漪）
// ==========================================
function closeFabMenu(instant = false) {
    const menu = document.getElementById('fab-menu');
    const mainBtn = document.getElementById('fab-main');
    if (!menu || !menu.classList.contains('show')) return;
    if (instant) {
        menu.style.transition = 'none';
        menu.classList.remove('show');
        menu.setAttribute('aria-hidden', 'true');
        if (mainBtn) mainBtn.setAttribute('aria-expanded', 'false');
        requestAnimationFrame(() => {
            menu.style.transition = '';
        });
        return;
    }
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
    if (mainBtn) mainBtn.setAttribute('aria-expanded', 'false');
}
window.closeFabMenu = closeFabMenu;

let lastGlobalClickParticleTime = 0;

document.addEventListener('click', (e) => {
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.classList.contains('show') && !panel.contains(e.target) && !bell?.contains(e.target)) {
        panel.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
        bell?.setAttribute('aria-expanded', 'false');
    }

    const fabContainer = document.getElementById('fab-container');
    const fabMenu = document.getElementById('fab-menu');
    if (fabMenu && fabMenu.classList.contains('show') && !fabContainer?.contains(e.target)) {
        closeFabMenu(false);
    }

    if (document.body.classList.contains('app-page-active') || document.body.classList.contains('is-scroll-locked')) return;
    if (e.target.closest('button, a, input, textarea, select, dialog, .modal-overlay, audio, video, .fab-container, .notification-panel, .moment-card, [role="button"]')) return;

    const now = performance.now();
    if (now - lastGlobalClickParticleTime < 200) return;
    lastGlobalClickParticleTime = now;

    spawnHearts(e.clientX, e.clientY);
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const panel = document.getElementById('notification-panel');
    const bell = document.getElementById('notification-bell');
    if (panel && panel.classList.contains('show')) {
        e.preventDefault();
        panel.classList.remove('show');
        panel.setAttribute('aria-hidden', 'true');
        bell?.setAttribute('aria-expanded', 'false');
        bell?.focus?.({ preventScroll: true });
        return;
    }
    const fabMenu = document.getElementById('fab-menu');
    const fabMain = document.getElementById('fab-main');
    if (fabMenu && fabMenu.classList.contains('show')) {
        e.preventDefault();
        closeFabMenu(false);
        fabMain?.focus?.({ preventScroll: true });
    }
});
