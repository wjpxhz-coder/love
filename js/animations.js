// ==========================================
// 2. 蝴蝶与樱花动画引擎 (高刷丝滑 & 饱满漫天花雨)
// ==========================================
const animationsReducedMotionQuery = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function getAnimationDevicePixelRatio() {
    return Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
}

function sizeAnimationCanvas(canvas, context, width, height) {
    const dpr = getAnimationDevicePixelRatio();
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

(function setupHomeSakuraEffect() {
    const canvasBg = document.getElementById('sakura-canvas');
    const canvasFg = document.getElementById('sakura-canvas-foreground');
    if (!canvasBg || !canvasFg) return;
    const ctxBg = canvasBg.getContext('2d', { alpha: true });
    const ctxFg = canvasFg.getContext('2d', { alpha: true });
    if (!ctxBg || !ctxFg) return;

    const MOBILE_BREAKPOINT = 768;
    const MAX_DELTA_SEC = 0.05; // 限制单帧最大步长，防后台切回飞跳

    let canvasWidth = Math.max(window.innerWidth, 1);
    let canvasHeight = Math.max(window.innerHeight, 1);
    let isMobile = canvasWidth < MOBILE_BREAKPOINT;
    let baseWind = 1.15;
    let bgPetals = [];
    let fgPetals = [];
    let burstPetals = [];
    let animationFrameId = null;
    let routeActive = isInitialHomeLocation();
    let lastRafTimestamp = 0;
    let simTime = 0;
    let resizeTimer = null;

    let appearance = {
        theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
        bothOnline: false
    };

    function isInitialHomeLocation() {
        const hash = window.location.hash;
        return !hash
            || hash === '#'
            || !hash.startsWith('#/')
            || hash === '#/'
            || hash.startsWith('#/?');
    }

    // 鼠标微风交互状态与平滑衰减
    const mouse = {
        x: -2000,
        y: -2000,
        vx: 0,
        vy: 0,
        lastX: 0,
        lastY: 0,
        lastTime: 0,
        active: false
    };

    window.addEventListener('mousemove', (e) => {
        const now = performance.now();
        const dt = Math.max(1, now - (mouse.lastTime || now - 16));
        mouse.vx = Math.max(-15, Math.min(15, (e.clientX - mouse.lastX) / dt * 10));
        mouse.vy = Math.max(-15, Math.min(15, (e.clientY - mouse.lastY) / dt * 10));
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        mouse.lastTime = now;
        mouse.active = true;
    }, { passive: true });

    function getPalette(theme, online) {
        const isDark = theme === 'dark';
        if (isDark) {
            return {
                shades: [
                    { c1: '#4a263d', c2: '#d87093', c3: '#ffb6c1', vein: 'rgba(255, 200, 220, 0.55)', aura: 'rgba(255, 182, 193, 0.4)' },
                    { c1: '#361b3b', c2: '#c7608e', c3: '#f79ac0', vein: 'rgba(247, 154, 192, 0.5)', aura: 'rgba(247, 154, 192, 0.35)' },
                    { c1: '#421f44', c2: '#e580a8', c3: '#ffd1e0', vein: 'rgba(255, 220, 235, 0.6)', aura: 'rgba(255, 209, 224, 0.45)' }
                ],
                butterfly: { wing: '#f09ebb', body: '#9c6f80', cream: '#fcedea' },
                stardust: online ? 'rgba(255, 223, 100, 0.9)' : 'rgba(255, 192, 203, 0.75)',
                goldAccent: online ? '#ffd166' : null
            };
        }
        return {
            shades: [
                { c1: '#ffffff', c2: '#ff809b', c3: '#ff4d6d', vein: 'rgba(255, 255, 255, 0.75)', aura: 'rgba(255, 105, 135, 0.3)' },
                { c1: '#fff2f5', c2: '#ff94b0', c3: '#f72585', vein: 'rgba(255, 255, 255, 0.68)', aura: 'rgba(247, 37, 133, 0.25)' },
                { c1: '#ffffff', c2: '#ffb3cb', c3: '#e05780', vein: 'rgba(255, 255, 255, 0.85)', aura: 'rgba(224, 87, 128, 0.3)' }
            ],
            butterfly: { wing: '#e26d8b', body: '#6e4550', cream: '#ffe5dd' },
            stardust: online ? 'rgba(255, 215, 60, 0.95)' : 'rgba(255, 182, 193, 0.8)',
            goldAccent: online ? '#ffd166' : null
        };
    }

    let currentPalette = getPalette(appearance.theme, appearance.bothOnline);

    // ── 离屏高质量纹理预烘焙缓存（完全消除每帧渐变与复杂曲线开销） ──
    const petalTextures = {
        petals: [],
        twinPetals: [],
        blossoms: [],
        heartPetals: [],
        stardust: []
    };

    function bakeTextures() {
        const palette = currentPalette;
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        const TEX_SIZE = 64;
        const texDim = Math.round(TEX_SIZE * dpr);

        petalTextures.petals = [];
        petalTextures.twinPetals = [];
        petalTextures.blossoms = [];
        petalTextures.heartPetals = [];
        petalTextures.stardust = [];

        // 1. 预烘焙 3 种色调的拟真单瓣桃花 (Petal)
        for (let i = 0; i < palette.shades.length; i++) {
            const shade = palette.shades[i];
            const canvas = document.createElement('canvas');
            canvas.width = texDim;
            canvas.height = texDim;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cx = 32;
            const cy = 56;
            const s = 26;

            ctx.save();
            ctx.translate(cx, cy);

            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-s * 0.85, -s * 0.55, -s * 0.75, -s * 1.5, 0, -s * 1.85);
            ctx.bezierCurveTo(s * 0.75, -s * 1.5, s * 0.85, -s * 0.55, 0, 0);

            const grad = ctx.createRadialGradient(0, -s * 0.4, 0, 0, -s * 0.95, s * 1.25);
            grad.addColorStop(0, shade.c1);
            grad.addColorStop(0.65, shade.c2);
            grad.addColorStop(1, shade.c3);
            ctx.fillStyle = grad;
            ctx.fill();

            // 中心立体脉纹
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.1);
            ctx.quadraticCurveTo(s * 0.06, -s * 0.8, 0, -s * 1.45);
            ctx.strokeStyle = shade.vein;
            ctx.lineWidth = 0.8;
            ctx.stroke();

            // 在线金色微光
            if (appearance.bothOnline && palette.goldAccent) {
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.45)';
                ctx.lineWidth = 0.9;
                ctx.stroke();
            }

            ctx.restore();
            petalTextures.petals.push(canvas);
        }

        // 2. 预烘焙 3 种双瓣并蒂落花 (Twin Petals)
        for (let i = 0; i < palette.shades.length; i++) {
            const shade = palette.shades[i];
            const canvas = document.createElement('canvas');
            canvas.width = texDim;
            canvas.height = texDim;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cx = 32;
            const cy = 36;
            const s = 18;

            ctx.save();
            ctx.translate(cx, cy);

            // 第一片花瓣 (偏左)
            ctx.save();
            ctx.rotate(-0.35);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-s * 0.8, -s * 0.6, -s * 0.7, -s * 1.5, 0, -s * 1.8);
            ctx.bezierCurveTo(s * 0.7, -s * 1.5, s * 0.8, -s * 0.6, 0, 0);
            const grad1 = ctx.createRadialGradient(0, -s * 0.4, 0, 0, -s * 0.9, s * 1.2);
            grad1.addColorStop(0, shade.c1);
            grad1.addColorStop(0.7, shade.c2);
            grad1.addColorStop(1, shade.c3);
            ctx.fillStyle = grad1;
            ctx.fill();
            ctx.restore();

            // 第二片花瓣 (偏右叠合)
            ctx.save();
            ctx.rotate(0.32);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(-s * 0.8, -s * 0.6, -s * 0.7, -s * 1.5, 0, -s * 1.8);
            ctx.bezierCurveTo(s * 0.7, -s * 1.5, s * 0.8, -s * 0.6, 0, 0);
            const grad2 = ctx.createRadialGradient(0, -s * 0.4, 0, 0, -s * 0.9, s * 1.2);
            grad2.addColorStop(0, shade.c1);
            grad2.addColorStop(0.7, shade.c2);
            grad2.addColorStop(1, shade.c3);
            ctx.fillStyle = grad2;
            ctx.fill();
            ctx.restore();

            ctx.restore();
            petalTextures.twinPetals.push(canvas);
        }

        // 3. 预烘焙 3 种盛开五瓣小桃花 (Blossom)
        for (let i = 0; i < palette.shades.length; i++) {
            const shade = palette.shades[i];
            const canvas = document.createElement('canvas');
            canvas.width = texDim;
            canvas.height = texDim;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cx = 32;
            const cy = 32;
            const bs = 16;

            ctx.save();
            ctx.translate(cx, cy);

            for (let b = 0; b < 5; b++) {
                ctx.save();
                ctx.rotate(b * Math.PI * 2 / 5);
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.bezierCurveTo(-bs * 0.5, -bs * 0.4, -bs * 0.45, -bs * 0.95, 0, -bs * 1.2);
                ctx.bezierCurveTo(bs * 0.45, -bs * 0.95, bs * 0.5, -bs * 0.4, 0, 0);
                const bgrad = ctx.createRadialGradient(0, -bs * 0.2, 0, 0, -bs * 0.6, bs * 0.95);
                bgrad.addColorStop(0, shade.c1);
                bgrad.addColorStop(0.7, shade.c2);
                bgrad.addColorStop(1, shade.c3);
                ctx.fillStyle = bgrad;
                ctx.fill();
                ctx.restore();
            }

            // 花蕊核心
            ctx.beginPath();
            ctx.arc(0, 0, bs * 0.24, 0, Math.PI * 2);
            ctx.fillStyle = appearance.bothOnline ? '#ffd166' : (appearance.theme === 'dark' ? '#ffccd5' : '#ff3366');
            ctx.fill();

            // 花蕊微点
            for (let d = 0; d < 5; d++) {
                const angle = d * Math.PI * 2 / 5;
                const r = bs * 0.38;
                ctx.beginPath();
                ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, 0.9, 0, Math.PI * 2);
                ctx.fillStyle = appearance.bothOnline ? '#fff0a0' : '#ffffff';
                ctx.fill();
            }

            ctx.restore();
            petalTextures.blossoms.push(canvas);
        }

        // 4. 预烘焙 3 种浪漫爱心小花瓣 (Heart Petal)
        for (let i = 0; i < palette.shades.length; i++) {
            const shade = palette.shades[i];
            const canvas = document.createElement('canvas');
            canvas.width = texDim;
            canvas.height = texDim;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cx = 32;
            const cy = 32;
            const hs = 14;

            ctx.save();
            ctx.translate(cx, cy);

            ctx.beginPath();
            ctx.moveTo(0, hs * 0.7);
            ctx.bezierCurveTo(-hs * 1.3, -hs * 0.3, -hs * 0.8, -hs * 1.2, 0, -hs * 0.5);
            ctx.bezierCurveTo(hs * 0.8, -hs * 1.2, hs * 1.3, -hs * 0.3, 0, hs * 0.7);

            const hgrad = ctx.createRadialGradient(0, 0, 0, 0, 0, hs * 1.2);
            hgrad.addColorStop(0, shade.c1);
            hgrad.addColorStop(0.6, shade.c2);
            hgrad.addColorStop(1, shade.c3);
            ctx.fillStyle = hgrad;
            ctx.fill();

            ctx.restore();
            petalTextures.heartPetals.push(canvas);
        }

        // 5. 预烘焙 3 种柔光星尘/梦幻光斑 (Stardust)
        for (let i = 0; i < 3; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = texDim;
            canvas.height = texDim;
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const cx = 32;
            const cy = 32;
            const rad = 14 + i * 4;

            ctx.save();
            ctx.translate(cx, cy);

            const sgrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
            sgrad.addColorStop(0, '#ffffff');
            sgrad.addColorStop(0.3, palette.stardust);
            sgrad.addColorStop(0.75, palette.shades[i % palette.shades.length].aura);
            sgrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = sgrad;
            ctx.beginPath();
            ctx.arc(0, 0, rad, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
            petalTextures.stardust.push(canvas);
        }
    }

    bakeTextures();

    // ── 桃花与落花粒子核心物理类 ──
    class PeachPetal {
        constructor(layer = 'background', isBurst = false, bx = 0, by = 0, initSpawn = false) {
            this.layer = layer;
            this.reset(isBurst, bx, by, initSpawn);
        }

        reset(isBurst = false, bx = 0, by = 0, initSpawn = false) {
            const isFg = this.layer === 'foreground';
            this.isBurst = isBurst;

            if (isBurst) {
                this.x = bx;
                this.y = by;
                const angle = Math.random() * Math.PI * 2;
                const speed = 2.5 + Math.random() * 7.5;
                this.vx = Math.cos(angle) * speed;
                this.vy = Math.sin(angle) * speed - 1.5;
                this.life = 1.0;
                this.decay = 0.012 + Math.random() * 0.018;
            } else {
                this.vx = (Math.random() - 0.5) * 0.7;
                this.vy = isFg ? (1.3 + Math.random() * 2.1) : (0.85 + Math.random() * 1.6);
                this.life = 1.0;
                this.decay = 0;

                if (initSpawn) {
                    this.x = Math.random() * canvasWidth;
                    this.y = Math.random() * canvasHeight;
                } else {
                    // 全屏迎风立体循环注入
                    const wind = baseWind;
                    const avgVy = Math.max(0.6, this.vy);
                    const horizontalDrift = Math.abs(wind) * (canvasHeight / avgVy);

                    if (wind >= 0.2) {
                        const leftWeight = canvasHeight;
                        const topWeight = canvasWidth + horizontalDrift;
                        const totalWeight = leftWeight + topWeight;

                        if (Math.random() * totalWeight < leftWeight) {
                            this.x = -Math.random() * 90 - 20;
                            this.y = Math.random() * (canvasHeight + 40) - 20;
                        } else {
                            this.x = Math.random() * (canvasWidth + horizontalDrift) - horizontalDrift;
                            this.y = -Math.random() * 70 - 20;
                        }
                    } else if (wind <= -0.2) {
                        const rightWeight = canvasHeight;
                        const topWeight = canvasWidth + horizontalDrift;
                        const totalWeight = rightWeight + topWeight;

                        if (Math.random() * totalWeight < rightWeight) {
                            this.x = canvasWidth + Math.random() * 90 + 20;
                            this.y = Math.random() * (canvasHeight + 40) - 20;
                        } else {
                            this.x = Math.random() * (canvasWidth + horizontalDrift);
                            this.y = -Math.random() * 70 - 20;
                        }
                    } else {
                        this.x = Math.random() * (canvasWidth + 140) - 70;
                        this.y = -Math.random() * 70 - 20;
                    }
                }
            }

            // 尺寸与层级景深
            this.baseSize = isFg ? (7.0 + Math.random() * 5.5) : (4.0 + Math.random() * 4.2);
            this.angle = Math.random() * Math.PI * 2;
            this.angleSpeed = (Math.random() - 0.5) * 0.032;
            this.flip = Math.random() * Math.PI * 2;
            this.flipSpeed = 0.02 + Math.random() * 0.038;
            this.sway = Math.random() * Math.PI * 2;
            this.swaySpeed = 0.02 + Math.random() * 0.032;
            this.swayAmp = 0.8 + Math.random() * 1.1;
            this.opacity = isFg ? (0.78 + Math.random() * 0.22) : (0.38 + Math.random() * 0.35);
            this.shadeIndex = Math.floor(Math.random() * 3);

            // 多样化浪漫粒子分布：
            // 72% 经典单瓣, 10% 优雅双瓣, 7% 盛开五瓣, 6% 梦幻星尘光斑, 3% 爱心花瓣, 2% 灵动微蝶
            const roll = Math.random();
            if (roll < 0.72) this.type = 'petal';
            else if (roll < 0.82) this.type = 'twin_petal';
            else if (roll < 0.89) this.type = 'blossom';
            else if (roll < 0.95) this.type = 'stardust';
            else if (roll < 0.98) this.type = 'heart_petal';
            else this.type = 'butterfly';
        }

        update(dtSec = 0.016, globalWind = 1.15) {
            const step = dtSec * 60; // 归一化到 60fps 步长

            this.sway += this.swaySpeed * step;
            this.flip += this.flipSpeed * step;
            this.angle += this.angleSpeed * step;

            const windOscillation = Math.sin(this.sway) * this.swayAmp;
            let currentVx = this.vx + globalWind + windOscillation;
            let currentVy = this.vy;

            // 鼠标微风交互排斥力
            if (mouse.active) {
                const dx = this.x - mouse.x;
                const dy = this.y - mouse.y;
                const distSq = dx * dx + dy * dy;
                const maxDist = 180;
                if (distSq < maxDist * maxDist && distSq > 4) {
                    const dist = Math.sqrt(distSq);
                    const force = (maxDist - dist) / maxDist;
                    currentVx += (dx / dist) * force * 4.8 + mouse.vx * 0.2;
                    currentVy += (dy / dist) * force * 4.8 + mouse.vy * 0.2;
                }
            }

            if (this.isBurst) {
                this.x += this.vx * step;
                this.y += this.vy * step;
                this.vx *= Math.pow(0.95, step);
                this.vy *= Math.pow(0.95, step);
                this.vy += 0.07 * step; // 重力沉降
                this.life -= this.decay * step;
            } else {
                this.x += currentVx * step;
                this.y += currentVy * step;

                if (this.type === 'butterfly') {
                    this.y -= Math.sin(this.flip * 2.2) * 1.8 * step;
                } else if (this.type === 'stardust') {
                    // 星尘微光悬浮漂游
                    this.y -= 0.25 * step;
                }

                // 边界循环回收
                const wind = baseWind;
                const horizontalDrift = Math.abs(wind) * (canvasHeight / Math.max(0.6, this.vy));
                let out = false;

                if (this.y > canvasHeight + 70) {
                    out = true;
                } else if (wind >= 0 && this.x > canvasWidth + 120) {
                    out = true;
                } else if (wind < 0 && this.x < -120) {
                    out = true;
                } else if (wind >= 0 && this.x < -horizontalDrift - 300) {
                    out = true;
                } else if (wind < 0 && this.x > canvasWidth + horizontalDrift + 300) {
                    out = true;
                }

                if (out) this.reset();
            }
        }

        draw(ctx) {
            if (this.isBurst && this.life <= 0) return;

            const s = this.baseSize;
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);

            // 3D 翻转缩放 (星尘不翻转，呈呼吸光斑)
            if (this.type !== 'stardust') {
                ctx.scale(Math.sin(this.flip), 1);
            }

            const alpha = (this.isBurst ? this.life : 1) * this.opacity;
            ctx.globalAlpha = Math.max(0, Math.min(1, alpha));

            if (this.type === 'petal') {
                const tex = petalTextures.petals[this.shadeIndex];
                if (tex) {
                    const scale = s / 26;
                    ctx.drawImage(tex, -32 * scale, -56 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'twin_petal') {
                const tex = petalTextures.twinPetals[this.shadeIndex];
                if (tex) {
                    const scale = (s * 0.95) / 18;
                    ctx.drawImage(tex, -32 * scale, -36 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'blossom') {
                const tex = petalTextures.blossoms[this.shadeIndex];
                if (tex) {
                    const scale = (s * 0.92) / 16;
                    ctx.drawImage(tex, -32 * scale, -32 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'heart_petal') {
                const tex = petalTextures.heartPetals[this.shadeIndex];
                if (tex) {
                    const scale = (s * 0.85) / 14;
                    ctx.drawImage(tex, -32 * scale, -32 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'stardust') {
                const tex = petalTextures.stardust[this.shadeIndex];
                if (tex) {
                    const breath = 0.75 + Math.sin(this.sway * 2) * 0.25;
                    const scale = (s * breath) / 16;
                    ctx.drawImage(tex, -32 * scale, -32 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'butterfly') {
                // 灵动微蝶动画
                const flap = 0.3 + Math.abs(Math.cos(this.flip * 2.4)) * 0.7;
                const b = currentPalette.butterfly;
                ctx.scale(flap, 1);
                ctx.fillStyle = b.wing;
                ctx.beginPath();
                ctx.moveTo(-1, -1);
                ctx.bezierCurveTo(-s * 0.8, -s * 1.2, -s * 1.4, -s * 0.4, -1, 1);
                ctx.moveTo(1, -1);
                ctx.bezierCurveTo(s * 0.8, -s * 1.2, s * 1.4, -s * 0.4, 1, 1);
                ctx.fill();
                ctx.fillStyle = b.cream;
                ctx.beginPath();
                ctx.moveTo(-1, 1);
                ctx.bezierCurveTo(-s * 0.7, s * 0.4, -s * 0.9, s * 0.9, -1, 2);
                ctx.moveTo(1, 1);
                ctx.bezierCurveTo(s * 0.7, s * 0.4, s * 0.9, s * 0.9, 1, 2);
                ctx.fill();
            }

            ctx.restore();
        }
    }

    const MAX_BURST_PETALS = 60;
    function createPetalBurst(x, y, count = 16) {
        const availableSlots = Math.max(0, MAX_BURST_PETALS - burstPetals.length);
        const spawnCount = Math.min(count, availableSlots > 0 ? availableSlots : count);
        if (burstPetals.length + spawnCount > MAX_BURST_PETALS) {
            burstPetals.splice(0, Math.min(count, 20));
        }
        for (let i = 0; i < spawnCount; i++) {
            burstPetals.push(new PeachPetal('foreground', true, x, y));
        }
    }

    // ── 粒子目标数量配置（丰盈饱满） ──
    function getTargetCounts() {
        if (isMobile) {
            return {
                bg: 28,
                fg: 14
            };
        }
        return {
            bg: 56,
            fg: 28
        };
    }

    function syncPetalsPopulation(forceRebuild = false) {
        const counts = getTargetCounts();
        if (forceRebuild) {
            bgPetals = [];
            fgPetals = [];
        }
        while (bgPetals.length < counts.bg) {
            bgPetals.push(new PeachPetal('background', false, 0, 0, true));
        }
        while (bgPetals.length > counts.bg) {
            bgPetals.pop();
        }
        while (fgPetals.length < counts.fg) {
            fgPetals.push(new PeachPetal('foreground', false, 0, 0, true));
        }
        while (fgPetals.length > counts.fg) {
            fgPetals.pop();
        }
    }

    function sizeHomeCanvas(canvas, context, width, height, maxDpr) {
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), maxDpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in context) context.imageSmoothingQuality = 'high';
    }

    function resizeHomeCanvases() {
        const previousWidth = canvasWidth;
        const previousHeight = canvasHeight;
        const previousMobile = isMobile;
        canvasWidth = Math.max(window.innerWidth, 1);
        canvasHeight = Math.max(window.innerHeight, 1);
        isMobile = canvasWidth < MOBILE_BREAKPOINT;

        if (previousMobile !== isMobile) {
            syncPetalsPopulation(true);
        } else if (previousWidth > 0 && previousHeight > 0) {
            [...bgPetals, ...fgPetals].forEach(p => {
                p.x = p.x * canvasWidth / previousWidth;
                p.y = p.y * canvasHeight / previousHeight;
            });
        }

        const maxDpr = isMobile ? 1.5 : 2;
        sizeHomeCanvas(canvasBg, ctxBg, canvasWidth, canvasHeight, isMobile ? 1.2 : 1.5);
        sizeHomeCanvas(canvasFg, ctxFg, canvasWidth, canvasHeight, maxDpr);
        syncPetalsPopulation();
    }

    function clearAnimationCanvases() {
        ctxBg.clearRect(0, 0, canvasWidth, canvasHeight);
        ctxFg.clearRect(0, 0, canvasWidth, canvasHeight);
    }

    function shouldRunAnimation() {
        return routeActive
            && !document.hidden
            && animationsReducedMotionQuery?.matches !== true;
    }

    function stopAnimation() {
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        lastRafTimestamp = 0;
        clearAnimationCanvases();
    }

    function updateParticles(dtSec) {
        simTime += dtSec;
        const globalWind = baseWind + Math.sin(simTime * 0.7) * 0.35 + Math.cos(simTime * 0.3) * 0.2;

        for (let i = 0; i < bgPetals.length; i++) {
            bgPetals[i].update(dtSec, globalWind);
        }
        for (let i = 0; i < fgPetals.length; i++) {
            fgPetals[i].update(dtSec, globalWind);
        }
        for (let i = burstPetals.length - 1; i >= 0; i--) {
            burstPetals[i].update(dtSec, globalWind);
            if (burstPetals[i].life <= 0) {
                burstPetals.splice(i, 1);
            }
        }

        // 鼠标速度衰减与休眠
        if (mouse.active) {
            mouse.vx *= 0.92;
            mouse.vy *= 0.92;
            if (performance.now() - mouse.lastTime > 600) {
                mouse.active = false;
            }
        }
    }

    function drawFrame() {
        clearAnimationCanvases();
        for (let i = 0; i < bgPetals.length; i++) {
            bgPetals[i].draw(ctxBg);
        }
        for (let i = 0; i < fgPetals.length; i++) {
            fgPetals[i].draw(ctxFg);
        }
        for (let i = 0; i < burstPetals.length; i++) {
            burstPetals[i].draw(ctxFg);
        }
    }

    // ── 高刷新率原生帧率动画主循环 (无蓄水池抖动，60~120+ FPS 丝滑物理更新) ──
    function animate(timestamp) {
        animationFrameId = null;
        if (!shouldRunAnimation()) {
            stopAnimation();
            return;
        }

        const dtSec = lastRafTimestamp > 0
            ? Math.min((timestamp - lastRafTimestamp) / 1000, MAX_DELTA_SEC)
            : 0.016;
        lastRafTimestamp = timestamp;

        updateParticles(dtSec);
        drawFrame();

        if (shouldRunAnimation()) {
            animationFrameId = requestAnimationFrame(animate);
        }
    }

    function startAnimation() {
        if (animationFrameId !== null || !shouldRunAnimation()) return;
        lastRafTimestamp = 0;
        animationFrameId = requestAnimationFrame(animate);
    }

    function reconcileAnimationState() {
        if (shouldRunAnimation()) startAnimation();
        else stopAnimation();
    }

    document.addEventListener('visibilitychange', reconcileAnimationState);
    const handleReducedMotionChange = () => reconcileAnimationState();
    if (typeof animationsReducedMotionQuery?.addEventListener === 'function') {
        animationsReducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    } else if (typeof animationsReducedMotionQuery?.addListener === 'function') {
        animationsReducedMotionQuery.addListener(handleReducedMotionChange);
    }

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeHomeCanvases();
            if (shouldRunAnimation()) drawFrame();
        }, 150);
    });

    resizeHomeCanvases();

    window.homeSakuraEffect = Object.freeze({
        setRouteActive(isHome) {
            const nextActive = Boolean(isHome);
            if (routeActive === nextActive) return;
            routeActive = nextActive;
            reconcileAnimationState();
        },
        setAppearance(nextAppearance = {}) {
            const nextTheme = nextAppearance.theme === 'dark' ? 'dark' : 'light';
            const nextOnline = Boolean(nextAppearance.bothOnline);
            if (appearance.theme === nextTheme && appearance.bothOnline === nextOnline) return;
            appearance = { theme: nextTheme, bothOnline: nextOnline };
            currentPalette = getPalette(appearance.theme, appearance.bothOnline);
            bakeTextures();
        },
        createBurst(x, y, count = 16) {
            if (!shouldRunAnimation()) return;
            createPetalBurst(x, y, count);
        },
        triggerMissYouFlutter() {
            if (animationsReducedMotionQuery?.matches === true) return;
            const cx = canvasWidth / 2;
            const cy = canvasHeight * 0.38;
            burstPetals.length = 0;
            createPetalBurst(cx, cy, 24);
            createPetalBurst(cx - canvasWidth * 0.25, cy + 30, 16);
            createPetalBurst(cx + canvasWidth * 0.25, cy + 30, 16);

            // 注入一波加速飞落的浪漫花瓣
            const extraCount = isMobile ? 12 : 24;
            for (let i = 0; i < extraCount; i++) {
                const p = new PeachPetal('foreground', false, 0, 0, false);
                p.vy *= 1.45;
                p.y = -Math.random() * 90 - 20;
                p.x = Math.random() * canvasWidth;
                fgPetals.push(p);
            }
            setTimeout(() => {
                syncPetalsPopulation();
            }, 5500);
        }
    });

    reconcileAnimationState();
})();

// ==========================================
// 个人主页专属：漫天飘落爱心和樱花粒子特效 (预渲染雪碧图 + 丝滑高刷)
// ==========================================
let profileParticlesReq = null;
let profileParticles = [];
let profileParticlesRequested = false;
let profileLastRafTimestamp = 0;
const profileEmojis = ['🌸', '💮', '💖', '✨', '💕', '🎀', '🌷', '💗'];
const profileEmojiSpriteMap = {};

function getEmojiSprite(emoji, size = 32) {
    const key = `${emoji}_${size}`;
    if (profileEmojiSpriteMap[key]) return profileEmojiSpriteMap[key];
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
    const canvas = document.createElement('canvas');
    const dim = Math.round((size + 8) * dpr);
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, (size + 8) / 2, (size + 8) / 2);
    profileEmojiSpriteMap[key] = { canvas, size: size + 8 };
    return profileEmojiSpriteMap[key];
}

// 提前预热主页 Emoji 雪碧图
profileEmojis.forEach(e => {
    getEmojiSprite(e, 24);
    getEmojiSprite(e, 32);
});

function pauseProfileParticles(clearCanvas = false) {
    if (profileParticlesReq !== null) cancelAnimationFrame(profileParticlesReq);
    profileParticlesReq = null;
    profileLastRafTimestamp = 0;
    if (clearCanvas) {
        const canvas = document.getElementById('profile-particles-canvas');
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function startProfileParticles() {
    const canvas = document.getElementById('profile-particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    profileParticlesRequested = true;
    pauseProfileParticles();
    const canvasWidth = Math.max(window.innerWidth, 1);
    const canvasHeight = Math.max(window.innerHeight, 1);
    sizeAnimationCanvas(canvas, ctx, canvasWidth, canvasHeight);

    if (animationsReducedMotionQuery?.matches === true || document.hidden) {
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return;
    }

    const isMobile = window.innerWidth < 768;
    const particleCount = isMobile ? 18 : 34;
    profileParticles = [];

    for (let i = 0; i < particleCount; i++) {
        const emoji = profileEmojis[Math.floor(Math.random() * profileEmojis.length)];
        const size = Math.floor(Math.random() * 12 + 18);
        profileParticles.push({
            x: Math.random() * canvasWidth,
            y: Math.random() * (canvasHeight + 100) - 50,
            size,
            speedY: Math.random() * 1.8 + 1.1,
            speedX: (Math.random() - 0.5) * 0.9,
            sway: Math.random() * Math.PI * 2,
            swaySpeed: 0.02 + Math.random() * 0.03,
            emoji,
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 1.8,
            alpha: 0.65 + Math.random() * 0.3
        });
    }

    function render(timestamp) {
        profileParticlesReq = null;
        if (!profileParticlesRequested || animationsReducedMotionQuery?.matches === true || document.hidden) {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            return;
        }

        const dtSec = profileLastRafTimestamp > 0
            ? Math.min((timestamp - profileLastRafTimestamp) / 1000, 0.05)
            : 0.016;
        profileLastRafTimestamp = timestamp;
        const step = dtSec * 60;

        ctx.clearRect(0, 0, canvasWidth, canvasHeight);

        for (let i = 0; i < profileParticles.length; i++) {
            const p = profileParticles[i];
            p.sway += p.swaySpeed * step;
            p.y += p.speedY * step;
            p.x += (p.speedX + Math.sin(p.sway) * 0.65) * step;
            p.rotation += p.rotationSpeed * step;

            if (p.y > canvasHeight + 40) {
                p.y = -40;
                p.x = Math.random() * canvasWidth;
            }

            const spriteObj = getEmojiSprite(p.emoji, 28);
            if (spriteObj) {
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation * Math.PI / 180);
                ctx.globalAlpha = p.alpha;
                const drawScale = p.size / spriteObj.size;
                const half = spriteObj.size / 2;
                ctx.drawImage(
                    spriteObj.canvas,
                    -half * drawScale,
                    -half * drawScale,
                    spriteObj.size * drawScale,
                    spriteObj.size * drawScale
                );
                ctx.restore();
            }
        }

        profileParticlesReq = requestAnimationFrame(render);
    }

    profileLastRafTimestamp = 0;
    profileParticlesReq = requestAnimationFrame(render);
}

function stopProfileParticles() {
    profileParticlesRequested = false;
    pauseProfileParticles(true);
}

const handleProfileMotionPreference = () => {
    if (animationsReducedMotionQuery?.matches) {
        pauseProfileParticles(true);
    } else if (profileParticlesRequested && !document.hidden) {
        startProfileParticles();
    }
};

if (typeof animationsReducedMotionQuery?.addEventListener === 'function') {
    animationsReducedMotionQuery.addEventListener('change', handleProfileMotionPreference);
} else if (typeof animationsReducedMotionQuery?.addListener === 'function') {
    animationsReducedMotionQuery.addListener(handleProfileMotionPreference);
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        pauseProfileParticles();
    } else if (profileParticlesRequested && animationsReducedMotionQuery?.matches !== true) {
        startProfileParticles();
    }
});

let profileResizeTimer;
window.addEventListener('resize', () => {
    if (!profileParticlesRequested) return;
    clearTimeout(profileResizeTimer);
    profileResizeTimer = setTimeout(() => startProfileParticles(), 150);
});
