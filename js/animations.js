// ==========================================
// 2. 蝴蝶与樱花动画
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
    const ctxBg = canvasBg.getContext('2d');
    const ctxFg = canvasFg.getContext('2d');
    if (!ctxBg || !ctxFg) return;

    const MOBILE_BREAKPOINT = 768;
    const MAX_DELTA_MS = 50;
    const PERFORMANCE_WINDOW_MS = 2000;
    const PERFORMANCE_WARMUP_MS = 500;
    const MIN_HEALTHY_FPS = 45;
    const LONG_FRAME_MS = 50;
    const LONG_FRAME_LIMIT = 3;
    const FRAME_INTERVALS = [1000 / 60, 1000 / 60, 1000 / 30];

    let canvasWidth = Math.max(window.innerWidth, 1);
    let canvasHeight = Math.max(window.innerHeight, 1);
    let isMobile = canvasWidth < MOBILE_BREAKPOINT;
    let baseWind = 1.3;
    let bgPetals = [];
    let fgPetals = [];
    let burstPetals = [];
    let animationFrameId = null;
    let routeActive = isInitialHomeLocation();
    let qualityLevel = 0;
    let lastRafTimestamp = 0;
    let lastUpdateTimestamp = 0;
    let frameAccumulator = 0;
    let lastPresentedTimestamp = 0;
    let healthWindowStart = 0;
    let healthIntervalTotal = 0;
    let healthFrameCount = 0;
    let healthLongFrames = 0;
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

    // 鼠标风力感应与交互
    const mouse = {
        x: -1000,
        y: -1000,
        vx: 0,
        vy: 0,
        lastX: 0,
        lastY: 0,
        lastTime: Date.now(),
        active: false
    };

    window.addEventListener('mousemove', (e) => {
        const now = Date.now();
        const dt = Math.max(1, now - mouse.lastTime);
        mouse.vx = (e.clientX - mouse.lastX) / dt * 8;
        mouse.vy = (e.clientY - mouse.lastY) / dt * 8;
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.lastX = e.clientX;
        mouse.lastY = e.clientY;
        mouse.lastTime = now;
        mouse.active = true;
    });

    function getPalette(theme, online) {
        const isDark = theme === 'dark';
        if (isDark) {
            return {
                shades: [
                    { c1: '#42283b', c2: '#d47c9f', c3: '#ffccd5', vein: 'rgba(255, 204, 213, 0.45)' },
                    { c1: '#2c1a32', c2: '#b5648c', c3: '#f09bbd', vein: 'rgba(240, 155, 189, 0.4)' },
                    { c1: '#37203d', c2: '#df8eb0', c3: '#ffd7e6', vein: 'rgba(255, 215, 230, 0.5)' }
                ],
                butterfly: { wing: '#e7a1b5', body: '#a77b89', cream: '#f3d8d4' },
                goldAccent: online ? '#ffd166' : null
            };
        }
        return {
            shades: [
                { c1: '#fff0f3', c2: '#ff758f', c3: '#ff4d6d', vein: 'rgba(255, 255, 255, 0.65)' },
                { c1: '#ffe5ec', c2: '#ff85a1', c3: '#f72585', vein: 'rgba(255, 255, 255, 0.55)' },
                { c1: '#ffffff', c2: '#ffa6c9', c3: '#e05780', vein: 'rgba(255, 255, 255, 0.75)' }
            ],
            butterfly: { wing: '#d87891', body: '#74515a', cream: '#f6d4c7' },
            goldAccent: online ? '#ffd166' : null
        };
    }

    let currentPalette = getPalette(appearance.theme, appearance.bothOnline);

    // ── 离屏纹理预烘焙缓存（彻底消除逐帧动态创建 RadialGradient 的 GC 与性能开销） ──
    const petalTextures = {
        petals: [],
        blossoms: []
    };

    function bakeTextures() {
        const palette = currentPalette;
        const TEXTURE_SIZE = 64;
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        const texDim = Math.round(TEXTURE_SIZE * dpr);

        petalTextures.petals = [];
        petalTextures.blossoms = [];

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
            ctx.bezierCurveTo(-s * 0.8, -s * 0.6, -s * 0.7, -s * 1.5, 0, -s * 1.8);
            ctx.bezierCurveTo(s * 0.7, -s * 1.5, s * 0.8, -s * 0.6, 0, 0);

            const grad = ctx.createRadialGradient(0, -s * 0.4, 0, 0, -s * 0.9, s * 1.2);
            grad.addColorStop(0, shade.c1);
            grad.addColorStop(0.65, shade.c2);
            grad.addColorStop(1, shade.c3);
            ctx.fillStyle = grad;
            ctx.fill();

            // 中心细脉纹
            ctx.beginPath();
            ctx.moveTo(0, -s * 0.1);
            ctx.quadraticCurveTo(s * 0.05, -s * 0.8, 0, -s * 1.4);
            ctx.strokeStyle = shade.vein;
            ctx.lineWidth = 0.7;
            ctx.stroke();

            // 双方在线同频金色微光
            if (appearance.bothOnline && palette.goldAccent) {
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.45)';
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            ctx.restore();
            petalTextures.petals.push(canvas);
        }

        // 2. 预烘焙 3 种色调的五瓣盛开小桃花 (Blossom)
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
                ctx.bezierCurveTo(-bs * 0.45, -bs * 0.4, -bs * 0.4, -bs * 0.9, 0, -bs * 1.15);
                ctx.bezierCurveTo(bs * 0.4, -bs * 0.9, bs * 0.45, -bs * 0.4, 0, 0);
                const bgrad = ctx.createRadialGradient(0, -bs * 0.2, 0, 0, -bs * 0.6, bs * 0.9);
                bgrad.addColorStop(0, shade.c1);
                bgrad.addColorStop(0.7, shade.c2);
                bgrad.addColorStop(1, shade.c3);
                ctx.fillStyle = bgrad;
                ctx.fill();
                ctx.restore();
            }

            // 花蕊中心
            ctx.beginPath();
            ctx.arc(0, 0, bs * 0.22, 0, Math.PI * 2);
            ctx.fillStyle = appearance.bothOnline ? '#ffd166' : shade.c3;
            ctx.fill();

            ctx.restore();
            petalTextures.blossoms.push(canvas);
        }
    }

    bakeTextures();

    // ── 桃花花瓣粒子核心类 ──
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
                const speed = 2 + Math.random() * 6.5;
                this.vx = Math.cos(angle) * speed;
                this.vy = Math.sin(angle) * speed;
                this.life = 1.0;
                this.decay = 0.01 + Math.random() * 0.015;
            } else {
                this.vx = (Math.random() - 0.5) * 0.8;
                this.vy = isFg ? (1.5 + Math.random() * 2.2) : (1.1 + Math.random() * 1.8);
                this.life = 1.0;
                this.decay = 0;

                if (initSpawn) {
                    this.x = Math.random() * canvasWidth;
                    this.y = Math.random() * canvasHeight;
                } else {
                    // 动态迎风边界注入算法：确保风力拉满时全屏（包括边缘及死角）饱满飘落
                    const wind = baseWind;
                    const avgVy = Math.max(0.5, this.vy);
                    const horizontalDrift = Math.abs(wind) * (canvasHeight / avgVy);

                    if (wind >= 0.2) {
                        const leftWeight = canvasHeight;
                        const topWeight = canvasWidth + horizontalDrift;
                        const totalWeight = leftWeight + topWeight;

                        if (Math.random() * totalWeight < leftWeight) {
                            this.x = -Math.random() * 80 - 20;
                            this.y = Math.random() * (canvasHeight + 40) - 20;
                        } else {
                            this.x = Math.random() * (canvasWidth + horizontalDrift) - horizontalDrift;
                            this.y = -Math.random() * 60 - 20;
                        }
                    } else if (wind <= -0.2) {
                        const rightWeight = canvasHeight;
                        const topWeight = canvasWidth + horizontalDrift;
                        const totalWeight = rightWeight + topWeight;

                        if (Math.random() * totalWeight < rightWeight) {
                            this.x = canvasWidth + Math.random() * 80 + 20;
                            this.y = Math.random() * (canvasHeight + 40) - 20;
                        } else {
                            this.x = Math.random() * (canvasWidth + horizontalDrift);
                            this.y = -Math.random() * 60 - 20;
                        }
                    } else {
                        this.x = Math.random() * (canvasWidth + 120) - 60;
                        this.y = -Math.random() * 60 - 20;
                    }
                }
            }

            // 真实精致花瓣尺寸 (前景层更大、更有层次感)
            this.baseSize = isFg ? (6.5 + Math.random() * 5.0) : (4.5 + Math.random() * 4.0);
            this.angle = Math.random() * Math.PI * 2;
            this.angleSpeed = (Math.random() - 0.5) * 0.035;
            this.flip = Math.random() * Math.PI;
            this.flipSpeed = 0.02 + Math.random() * 0.035;
            this.sway = Math.random() * Math.PI * 2;
            this.swaySpeed = 0.02 + Math.random() * 0.03;
            this.opacity = isFg ? (0.75 + Math.random() * 0.25) : (0.45 + Math.random() * 0.3);
            this.shadeIndex = Math.floor(Math.random() * 3);

            // 5% 概率为整朵小桃花, 3% 为灵动微蝶, 92% 为贝塞尔曲线单瓣桃花
            const typeRoll = Math.random();
            if (typeRoll < 0.05) this.type = 'blossom';
            else if (typeRoll < 0.08) this.type = 'butterfly';
            else this.type = 'petal';
        }

        update(deltaFactor = 1) {
            this.sway += this.swaySpeed * deltaFactor;
            this.flip += this.flipSpeed * deltaFactor;
            this.angle += this.angleSpeed * deltaFactor;

            const windOscillation = Math.sin(this.sway) * 1.1;
            let currentVx = (this.vx + baseWind + windOscillation);
            let currentVy = this.vy;

            // 鼠标微风力场交互
            if (mouse.active) {
                const dx = this.x - mouse.x;
                const dy = this.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 170 && dist > 0) {
                    const force = (170 - dist) / 170;
                    currentVx += (dx / dist) * force * 5.0 + mouse.vx * 0.25;
                    currentVy += (dy / dist) * force * 5.0 + mouse.vy * 0.25;
                }
            }

            if (this.isBurst) {
                this.x += this.vx * deltaFactor;
                this.y += this.vy * deltaFactor;
                this.vx *= Math.pow(0.95, deltaFactor);
                this.vy *= Math.pow(0.95, deltaFactor);
                this.vy += 0.06 * deltaFactor;
                this.life -= this.decay * deltaFactor;
            } else {
                this.x += currentVx * deltaFactor;
                this.y += currentVy * deltaFactor;
                if (this.type === 'butterfly') {
                    this.y -= Math.sin(this.flip * 2) * 2.0 * deltaFactor;
                }

                // 越界重置检测
                const wind = baseWind;
                const horizontalDrift = Math.abs(wind) * (canvasHeight / Math.max(0.5, this.vy));
                let isOutOfBounds = false;

                if (this.y > canvasHeight + 60) {
                    isOutOfBounds = true;
                } else if (wind >= 0 && this.x > canvasWidth + 100) {
                    isOutOfBounds = true;
                } else if (wind < 0 && this.x < -100) {
                    isOutOfBounds = true;
                } else if (wind >= 0 && this.x < -horizontalDrift - 250) {
                    isOutOfBounds = true;
                } else if (wind < 0 && this.x > canvasWidth + horizontalDrift + 250) {
                    isOutOfBounds = true;
                }

                if (isOutOfBounds) {
                    this.reset();
                }
            }
        }

        draw(ctx) {
            if (this.isBurst && this.life <= 0) return;

            const s = this.baseSize;

            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.scale(Math.sin(this.flip), 1); // 3D 翻转效果
            ctx.globalAlpha = (this.isBurst ? this.life : 1) * this.opacity;

            if (this.type === 'petal') {
                const tex = petalTextures.petals[this.shadeIndex];
                if (tex) {
                    const scale = s / 26;
                    ctx.drawImage(tex, -32 * scale, -56 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'blossom') {
                const tex = petalTextures.blossoms[this.shadeIndex];
                if (tex) {
                    const scale = (s * 0.9) / 16;
                    ctx.drawImage(tex, -32 * scale, -32 * scale, 64 * scale, 64 * scale);
                }
            } else if (this.type === 'butterfly') {
                // 灵动微蝶
                const flap = 0.35 + Math.abs(Math.cos(this.flip * 2.2)) * 0.65;
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

    const MAX_BURST_PETALS = 36;
    function createPetalBurst(x, y, count = 10) {
        const availableSlots = Math.max(0, MAX_BURST_PETALS - burstPetals.length);
        const spawnCount = Math.min(count, availableSlots);
        if (spawnCount <= 0 && burstPetals.length >= MAX_BURST_PETALS) {
            burstPetals.splice(0, Math.min(count, 12));
        }
        const finalCount = Math.min(count, 14);
        for (let i = 0; i < finalCount; i++) {
            burstPetals.push(new PeachPetal('foreground', true, x, y));
        }
    }

    function getTargetCounts() {
        if (isMobile) {
            return {
                bg: qualityLevel >= 1 ? 12 : 18,
                fg: qualityLevel >= 1 ? 4 : 6
            };
        }
        return {
            bg: qualityLevel >= 1 ? 26 : 38,
            fg: qualityLevel >= 1 ? 10 : 14
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

    function getHomeDprCaps() {
        if (qualityLevel >= 2) return { background: 1, foreground: 1 };
        return isMobile
            ? { background: 1, foreground: 1.5 }
            : { background: 1.25, foreground: 1.75 };
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

    function resetPerformanceSampling(timestamp = performance.now(), warmup = PERFORMANCE_WARMUP_MS) {
        lastPresentedTimestamp = 0;
        healthWindowStart = timestamp + warmup;
        healthIntervalTotal = 0;
        healthFrameCount = 0;
        healthLongFrames = 0;
    }

    function resizeHomeCanvases() {
        const previousWidth = canvasWidth;
        const previousHeight = canvasHeight;
        const previousMobile = isMobile;
        canvasWidth = Math.max(window.innerWidth, 1);
        canvasHeight = Math.max(window.innerHeight, 1);
        isMobile = canvasWidth < MOBILE_BREAKPOINT;

        if (previousMobile !== isMobile) {
            bgPetals = [];
            fgPetals = [];
        } else if (previousWidth > 0 && previousHeight > 0) {
            [...bgPetals, ...fgPetals].forEach(p => {
                p.x = p.x * canvasWidth / previousWidth;
                p.y = p.y * canvasHeight / previousHeight;
            });
        }

        const caps = getHomeDprCaps();
        sizeHomeCanvas(canvasBg, ctxBg, canvasWidth, canvasHeight, caps.background);
        sizeHomeCanvas(canvasFg, ctxFg, canvasWidth, canvasHeight, caps.foreground);
        syncPetalsPopulation();
        resetPerformanceSampling();
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
        lastUpdateTimestamp = 0;
        frameAccumulator = 0;
        resetPerformanceSampling();
        clearAnimationCanvases();
    }

    function applyQualityLevel(nextLevel, timestamp) {
        if (nextLevel <= qualityLevel || nextLevel > 2) return;
        qualityLevel = nextLevel;
        syncPetalsPopulation();
        if (qualityLevel >= 2) resizeHomeCanvases();
        lastRafTimestamp = timestamp;
        lastUpdateTimestamp = timestamp;
        frameAccumulator = 0;
        resetPerformanceSampling(timestamp);
    }

    function recordPresentedFrame(timestamp) {
        if (qualityLevel >= 2) return;
        if (lastPresentedTimestamp === 0) {
            lastPresentedTimestamp = timestamp;
            return;
        }
        const interval = timestamp - lastPresentedTimestamp;
        lastPresentedTimestamp = timestamp;
        if (timestamp < healthWindowStart) return;

        healthIntervalTotal += interval;
        healthFrameCount += 1;
        if (interval > LONG_FRAME_MS) healthLongFrames += 1;
        if (timestamp - healthWindowStart < PERFORMANCE_WINDOW_MS) return;

        const averageInterval = healthFrameCount > 0
            ? healthIntervalTotal / healthFrameCount
            : 0;
        const averageFps = averageInterval > 0 ? 1000 / averageInterval : 60;
        const unhealthy = averageFps < MIN_HEALTHY_FPS || healthLongFrames >= LONG_FRAME_LIMIT;
        healthWindowStart = timestamp;
        healthIntervalTotal = 0;
        healthFrameCount = 0;
        healthLongFrames = 0;
        if (unhealthy) applyQualityLevel(qualityLevel + 1, timestamp);
    }

    function updateParticles(deltaSeconds) {
        const deltaFactor = Math.min(Math.max(deltaSeconds * 60, 0.2), 3);
        for (let i = 0; i < bgPetals.length; i++) {
            bgPetals[i].update(deltaFactor);
        }
        for (let i = 0; i < fgPetals.length; i++) {
            fgPetals[i].update(deltaFactor);
        }
        for (let i = burstPetals.length - 1; i >= 0; i--) {
            burstPetals[i].update(deltaFactor);
            if (burstPetals[i].life <= 0) {
                burstPetals.splice(i, 1);
            }
        }
        mouse.vx *= 0.9;
        mouse.vy *= 0.9;
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

    function animate(timestamp) {
        animationFrameId = null;
        if (!shouldRunAnimation()) {
            stopAnimation();
            return;
        }

        const targetInterval = FRAME_INTERVALS[qualityLevel];
        const rafElapsed = lastRafTimestamp > 0
            ? Math.min(timestamp - lastRafTimestamp, MAX_DELTA_MS)
            : targetInterval;
        lastRafTimestamp = timestamp;
        frameAccumulator += rafElapsed;

        if (frameAccumulator >= targetInterval) {
            const updateElapsed = lastUpdateTimestamp > 0
                ? Math.min(timestamp - lastUpdateTimestamp, MAX_DELTA_MS)
                : Math.min(frameAccumulator, MAX_DELTA_MS);
            lastUpdateTimestamp = timestamp;
            frameAccumulator = Math.max(0, frameAccumulator - targetInterval);
            recordPresentedFrame(timestamp);
            updateParticles(updateElapsed / 1000);
            drawFrame();
        }

        if (shouldRunAnimation()) animationFrameId = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (animationFrameId !== null || !shouldRunAnimation()) return;
        lastRafTimestamp = 0;
        lastUpdateTimestamp = 0;
        frameAccumulator = 0;
        resetPerformanceSampling();
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
        }, 200);
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
            resetPerformanceSampling();
        },
        createBurst(x, y, count = 10) {
            if (!shouldRunAnimation()) return;
            createPetalBurst(x, y, count);
        },
        triggerMissYouFlutter() {
            if (animationsReducedMotionQuery?.matches === true) return;
            const cx = canvasWidth / 2;
            const cy = canvasHeight * 0.42;
            // 先清理旧爆发，注入全新浪漫绽放
            burstPetals.length = 0;
            createPetalBurst(cx, cy, 18);
            createPetalBurst(cx - canvasWidth * 0.22, cy + 25, 10);
            createPetalBurst(cx + canvasWidth * 0.22, cy + 25, 10);

            // 补充注入一波浪漫飞落的桃花瓣
            const extraCount = isMobile ? 8 : 16;
            for (let i = 0; i < extraCount; i++) {
                const p = new PeachPetal('foreground', false, 0, 0, false);
                p.vy *= 1.35;
                p.y = -Math.random() * 80 - 20;
                p.x = Math.random() * canvasWidth;
                fgPetals.push(p);
            }
            setTimeout(() => {
                syncPetalsPopulation();
            }, 5000);
        }
    });

    reconcileAnimationState();
})();

// ==========================================
// 个人主页专属：漫天飘落爱心和樱花粒子特效
// ==========================================
let profileParticlesReq = null;
let profileParticles = [];
let profileParticlesRequested = false;
const emojis = ['🌸', '💮', '💖', '✨', '💕'];

function pauseProfileParticles(clearCanvas = false) {
    if (profileParticlesReq !== null) cancelAnimationFrame(profileParticlesReq);
    profileParticlesReq = null;
    if (clearCanvas) {
        const canvas = document.getElementById('profile-particles-canvas');
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function startProfileParticles() {
    const canvas = document.getElementById('profile-particles-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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
    profileParticles = [];
    for (let i = 0; i < (window.innerWidth < 768 ? 10 : 20); i++) {
        profileParticles.push({
            x: Math.random() * canvasWidth,
            y: Math.random() * canvasHeight - canvasHeight,
            size: Math.random() * 12 + 10,
            speedY: Math.random() * 2.5 + 1.2,
            speedX: (Math.random() - 0.5) * 1.5,
            emoji: emojis[Math.floor(Math.random() * emojis.length)],
            rotation: Math.random() * 360,
            rotationSpeed: (Math.random() - 0.5) * 2
        });
    }
    function render() {
        profileParticlesReq = null;
        if (!profileParticlesRequested || animationsReducedMotionQuery?.matches === true || document.hidden) {
            ctx.clearRect(0, 0, canvasWidth, canvasHeight);
            return;
        }
        ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        for (let i = 0; i < profileParticles.length; i++) {
            const p = profileParticles[i];
            p.y += p.speedY;
            p.x += p.speedX;
            p.rotation += p.rotationSpeed;
            if (p.y > canvasHeight + 30) {
                p.y = -30;
                p.x = Math.random() * canvasWidth;
            }
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.font = `${p.size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.8;
            ctx.fillText(p.emoji, 0, 0);
            ctx.restore();
        }
        profileParticlesReq = requestAnimationFrame(render);
    }
    render();
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
    profileResizeTimer = setTimeout(() => startProfileParticles(), 200);
});
