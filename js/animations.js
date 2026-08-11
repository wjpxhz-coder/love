// ==========================================
// 2. 蝴蝶与樱花动画
// ==========================================
let bothOnline = false;
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
    let particles = [];
    let spriteCache = null;
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

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function makePalette(theme, online) {
        const isDark = theme === 'dark';
        return {
            highlight: isDark ? '#FFE0E8' : '#FFD7E0',
            main: isDark ? '#F2A1BB' : '#F08FA8',
            base: isDark ? '#C76B8B' : '#C95D79',
            backHighlight: isDark ? '#FBE7ED' : '#FFE8ED',
            backMain: isDark ? '#DFA6BB' : '#F3B4C4',
            backBase: isDark ? '#B77791' : '#D58399',
            edge: isDark ? 'rgba(255, 210, 226, 0.55)' : 'rgba(169, 67, 95, 0.48)',
            vein: isDark ? 'rgba(128, 54, 91, 0.44)' : 'rgba(137, 53, 78, 0.36)',
            butterflyRose: isDark ? '#E7A1B5' : '#D87891',
            butterflyCream: isDark ? '#F3D8D4' : '#F6D4C7',
            butterflyBody: isDark ? '#A77B89' : '#74515A',
            accent: online ? '#D6A84A' : (isDark ? '#D6A6B6' : '#B77987'),
            accentSoft: online ? 'rgba(255, 226, 160, 0.72)' : 'rgba(255, 239, 243, 0.52)'
        };
    }

    function createMemorySprite(width, height, paint) {
        const scale = 2;
        const sprite = document.createElement('canvas');
        sprite.width = width * scale;
        sprite.height = height * scale;
        const context = sprite.getContext('2d');
        if (!context) return sprite;
        context.setTransform(scale, 0, 0, scale, 0, 0);
        paint(context, width, height);
        return sprite;
    }

    function tracePetal(context, width, height, widthFactor) {
        context.beginPath();
        context.moveTo(0, height * 0.34);
        context.bezierCurveTo(
            -width * 0.18 * widthFactor, height * 0.2,
            -width * 0.36 * widthFactor, -height * 0.06,
            -width * 0.27 * widthFactor, -height * 0.27
        );
        context.bezierCurveTo(
            -width * 0.22 * widthFactor, -height * 0.43,
            -width * 0.08 * widthFactor, -height * 0.45,
            0, -height * 0.32
        );
        context.bezierCurveTo(
            width * 0.08 * widthFactor, -height * 0.45,
            width * 0.22 * widthFactor, -height * 0.43,
            width * 0.27 * widthFactor, -height * 0.27
        );
        context.bezierCurveTo(
            width * 0.36 * widthFactor, -height * 0.06,
            width * 0.18 * widthFactor, height * 0.2,
            0, height * 0.34
        );
        context.closePath();
    }

    function paintPetalSprite(context, width, height, variant, palette) {
        const petalWidth = width * 0.88;
        const petalHeight = height * 0.9;
        const widthFactors = [1, 0.94, 0.76, 0.58];
        const isBack = variant === 1;
        context.save();
        context.translate(width / 2, height / 2);
        context.rotate(variant === 2 ? -0.12 : (variant === 3 ? 0.14 : 0));

        const fill = context.createLinearGradient(0, -petalHeight * 0.48, 0, petalHeight * 0.42);
        fill.addColorStop(0, isBack ? palette.backHighlight : palette.highlight);
        fill.addColorStop(0.52, isBack ? palette.backMain : palette.main);
        fill.addColorStop(1, isBack ? palette.backBase : palette.base);
        tracePetal(context, petalWidth, petalHeight, widthFactors[variant]);
        context.fillStyle = fill;
        context.fill();
        context.lineWidth = 0.7;
        context.strokeStyle = palette.edge;
        context.stroke();

        context.globalAlpha = isBack ? 0.28 : 0.42;
        context.strokeStyle = palette.vein;
        context.lineWidth = 0.55;
        context.beginPath();
        context.moveTo(0, petalHeight * 0.28);
        context.bezierCurveTo(-petalWidth * 0.02, petalHeight * 0.08, -petalWidth * 0.03, -petalHeight * 0.12, 0, -petalHeight * 0.3);
        context.moveTo(0, petalHeight * 0.2);
        context.quadraticCurveTo(-petalWidth * 0.13, petalHeight * 0.02, -petalWidth * 0.16, -petalHeight * 0.14);
        context.moveTo(0, petalHeight * 0.2);
        context.quadraticCurveTo(petalWidth * 0.13, petalHeight * 0.02, petalWidth * 0.16, -petalHeight * 0.14);
        context.stroke();

        if (variant === 2) {
            context.globalAlpha = 0.5;
            context.strokeStyle = palette.highlight;
            context.lineWidth = 1;
            context.beginPath();
            context.arc(petalWidth * 0.12, -petalHeight * 0.08, petalWidth * 0.12, -1.4, 1.25);
            context.stroke();
        }

        context.globalAlpha = 0.6;
        context.fillStyle = palette.accentSoft;
        context.beginPath();
        context.arc(0, petalHeight * 0.25, 1.45, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    function paintBlossomSprite(context, width, height, palette) {
        context.save();
        context.translate(width / 2, height / 2);
        for (let index = 0; index < 5; index += 1) {
            context.save();
            context.rotate(index * Math.PI * 2 / 5);
            const petalFill = context.createLinearGradient(0, -height * 0.3, 0, height * 0.04);
            petalFill.addColorStop(0, palette.highlight);
            petalFill.addColorStop(0.58, palette.main);
            petalFill.addColorStop(1, palette.base);
            context.fillStyle = petalFill;
            context.strokeStyle = palette.edge;
            context.lineWidth = 0.65;
            context.beginPath();
            context.moveTo(0, height * 0.02);
            context.bezierCurveTo(-width * 0.16, -height * 0.08, -width * 0.18, -height * 0.27, -width * 0.06, -height * 0.33);
            context.quadraticCurveTo(0, -height * 0.26, width * 0.06, -height * 0.33);
            context.bezierCurveTo(width * 0.18, -height * 0.27, width * 0.16, -height * 0.08, 0, height * 0.02);
            context.closePath();
            context.fill();
            context.stroke();
            context.restore();
        }

        context.fillStyle = palette.base;
        context.beginPath();
        context.arc(0, 0, width * 0.09, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = palette.accent;
        context.lineWidth = 0.75;
        for (let index = 0; index < 8; index += 1) {
            const angle = index * Math.PI / 4;
            context.beginPath();
            context.moveTo(Math.cos(angle) * width * 0.03, Math.sin(angle) * height * 0.03);
            context.lineTo(Math.cos(angle) * width * 0.14, Math.sin(angle) * height * 0.14);
            context.stroke();
            context.fillStyle = palette.accentSoft;
            context.beginPath();
            context.arc(Math.cos(angle) * width * 0.15, Math.sin(angle) * height * 0.15, 1.25, 0, Math.PI * 2);
            context.fill();
        }
        context.restore();
    }

    function paintButterflySprite(context, width, height, flap, palette) {
        context.save();
        context.translate(width / 2, height / 2);
        context.scale(flap, 1);
        context.fillStyle = palette.butterflyRose;
        context.strokeStyle = palette.accent;
        context.lineWidth = 0.8;

        context.beginPath();
        context.moveTo(-2, -1);
        context.bezierCurveTo(-width * 0.12, -height * 0.36, -width * 0.34, -height * 0.34, -width * 0.34, -height * 0.08);
        context.bezierCurveTo(-width * 0.34, height * 0.04, -width * 0.16, height * 0.08, -2, 2);
        context.closePath();
        context.fill();
        context.stroke();

        context.beginPath();
        context.moveTo(2, -1);
        context.bezierCurveTo(width * 0.12, -height * 0.36, width * 0.34, -height * 0.34, width * 0.34, -height * 0.08);
        context.bezierCurveTo(width * 0.34, height * 0.04, width * 0.16, height * 0.08, 2, 2);
        context.closePath();
        context.fill();
        context.stroke();

        context.fillStyle = palette.butterflyCream;
        context.beginPath();
        context.moveTo(-2, 1);
        context.bezierCurveTo(-width * 0.11, height * 0.02, -width * 0.25, height * 0.2, -width * 0.2, height * 0.31);
        context.quadraticCurveTo(-width * 0.08, height * 0.27, -2, 4);
        context.closePath();
        context.fill();
        context.stroke();

        context.beginPath();
        context.moveTo(2, 1);
        context.bezierCurveTo(width * 0.11, height * 0.02, width * 0.25, height * 0.2, width * 0.2, height * 0.31);
        context.quadraticCurveTo(width * 0.08, height * 0.27, 2, 4);
        context.closePath();
        context.fill();
        context.stroke();
        context.restore();

        context.fillStyle = palette.butterflyBody;
        context.beginPath();
        context.ellipse(width / 2, height / 2 + 1, 1.6, height * 0.2, 0, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = palette.butterflyBody;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(width / 2 - 0.5, height / 2 - height * 0.15);
        context.quadraticCurveTo(width / 2 - 4, height / 2 - height * 0.3, width / 2 - 7, height / 2 - height * 0.28);
        context.moveTo(width / 2 + 0.5, height / 2 - height * 0.15);
        context.quadraticCurveTo(width / 2 + 4, height / 2 - height * 0.3, width / 2 + 7, height / 2 - height * 0.28);
        context.stroke();
    }

    function rebuildSpriteCache() {
        const palette = makePalette(appearance.theme, appearance.bothOnline);
        const petals = [];
        for (let variant = 0; variant < 4; variant += 1) {
            petals.push(createMemorySprite(56, 64, (context, width, height) => {
                paintPetalSprite(context, width, height, variant, palette);
            }));
        }
        const blossom = createMemorySprite(68, 68, (context, width, height) => {
            paintBlossomSprite(context, width, height, palette);
        });
        const flapStates = [0.32, 0.62, 1, 0.62];
        const butterflies = flapStates.map(flap => createMemorySprite(68, 50, (context, width, height) => {
            paintButterflySprite(context, width, height, flap, palette);
        }));
        spriteCache = { petals, blossom, butterflies };
    }

    function addSpecs(specs, type, layer, count) {
        for (let index = 0; index < count; index += 1) specs.push({ type, layer });
    }

    function getParticleSpecs() {
        const specs = [];
        if (isMobile) {
            addSpecs(specs, 'petal', 'background', 8);
            addSpecs(specs, 'butterfly', 'background', 1);
            addSpecs(specs, 'petal', 'foreground', 2);
            addSpecs(specs, 'blossom', 'foreground', 1);
        } else {
            addSpecs(specs, 'petal', 'background', 16);
            addSpecs(specs, 'blossom', 'background', 2);
            addSpecs(specs, 'butterfly', 'background', 2);
            addSpecs(specs, 'petal', 'foreground', 3);
            addSpecs(specs, 'blossom', 'foreground', 1);
        }

        if (qualityLevel >= 1) {
            const backgroundCount = specs.filter(spec => spec.layer === 'background').length;
            let removeCount = backgroundCount - Math.ceil(backgroundCount * 0.75);
            for (let index = specs.length - 1; index >= 0 && removeCount > 0; index -= 1) {
                if (specs[index].layer === 'background' && specs[index].type === 'petal') {
                    specs.splice(index, 1);
                    removeCount -= 1;
                }
            }
        }
        return specs;
    }

    function resetParticle(particle, initial = false) {
        const foreground = particle.layer === 'foreground';
        particle.x = Math.random() * canvasWidth;
        particle.y = initial
            ? randomBetween(-canvasHeight * 0.08, canvasHeight)
            : randomBetween(-90, -24);
        particle.alpha = foreground ? randomBetween(0.55, 0.72) : randomBetween(0.32, 0.48);
        particle.speedX = randomBetween(-5, 5);
        particle.speedY = foreground ? randomBetween(66, 100) : randomBetween(44, 66);
        particle.swayPhase = Math.random() * Math.PI * 2;
        particle.swayFrequency = randomBetween(0.72, 1.45);
        particle.swayVelocity = foreground ? randomBetween(11, 20) : randomBetween(7, 14);
        particle.rotation = Math.random() * Math.PI * 2;
        particle.rotationSpeed = randomBetween(-0.72, 0.72);
        particle.flipPhase = Math.random() * Math.PI * 2;
        particle.flipSpeed = randomBetween(1.25, 2.6);
        particle.flapPhase = Math.random() * Math.PI * 2;
        particle.flapSpeed = randomBetween(5.4, 8.2);
        particle.spriteIndex = Math.floor(Math.random() * 4);

        if (particle.type === 'petal') {
            particle.size = foreground ? randomBetween(22, 30) : randomBetween(13, 20);
        } else if (particle.type === 'blossom') {
            particle.size = foreground ? randomBetween(28, 35) : randomBetween(18, 24);
            particle.speedY *= 0.88;
            particle.rotationSpeed *= 0.72;
        } else {
            particle.size = foreground ? randomBetween(26, 32) : randomBetween(20, 27);
            particle.speedY = foreground ? randomBetween(48, 68) : randomBetween(34, 56);
            particle.speedX = randomBetween(-8, 8);
            particle.swayVelocity *= 1.35;
            particle.rotationSpeed *= 0.4;
        }
    }

    function createParticle(spec) {
        const particle = { type: spec.type, layer: spec.layer };
        resetParticle(particle, true);
        return particle;
    }

    function syncParticlePopulation(forceRebuild = false) {
        const specs = getParticleSpecs();
        if (forceRebuild) particles = [];
        const pool = particles.slice();
        const nextParticles = [];
        for (let index = 0; index < specs.length; index += 1) {
            const spec = specs[index];
            const matchIndex = pool.findIndex(particle => (
                particle.type === spec.type && particle.layer === spec.layer
            ));
            if (matchIndex >= 0) nextParticles.push(pool.splice(matchIndex, 1)[0]);
            else nextParticles.push(createParticle(spec));
        }
        particles = nextParticles;
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
            particles = [];
        } else if (previousWidth > 0 && previousHeight > 0) {
            for (let index = 0; index < particles.length; index += 1) {
                particles[index].x = particles[index].x * canvasWidth / previousWidth;
                particles[index].y = particles[index].y * canvasHeight / previousHeight;
            }
        }

        const caps = getHomeDprCaps();
        sizeHomeCanvas(canvasBg, ctxBg, canvasWidth, canvasHeight, caps.background);
        sizeHomeCanvas(canvasFg, ctxFg, canvasWidth, canvasHeight, caps.foreground);
        syncParticlePopulation();
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
        syncParticlePopulation();
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
        const onlineMultiplier = appearance.bothOnline ? 1.1 : 1;
        for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            particle.swayPhase += particle.swayFrequency * deltaSeconds * onlineMultiplier;
            particle.flipPhase += particle.flipSpeed * deltaSeconds * onlineMultiplier;
            particle.rotation += particle.rotationSpeed * deltaSeconds * onlineMultiplier;
            particle.x += (
                particle.speedX + Math.sin(particle.swayPhase) * particle.swayVelocity
            ) * deltaSeconds * onlineMultiplier;
            particle.y += particle.speedY * deltaSeconds * onlineMultiplier;
            if (particle.type === 'butterfly') {
                particle.flapPhase += particle.flapSpeed * deltaSeconds * onlineMultiplier;
                particle.y -= Math.sin(particle.flapPhase) * 4.5 * deltaSeconds;
            }

            const margin = particle.size * 2;
            if (particle.y > canvasHeight + margin) {
                resetParticle(particle);
            } else if (particle.x < -margin) {
                particle.x = canvasWidth + margin;
            } else if (particle.x > canvasWidth + margin) {
                particle.x = -margin;
            }
        }
    }

    function drawParticle(context, particle) {
        let sprite;
        let drawWidth;
        let drawHeight;
        let flipScale = 1;
        if (particle.type === 'petal') {
            const facingBack = Math.sin(particle.flipPhase) < -0.12;
            const spriteIndex = facingBack
                ? 1
                : particle.spriteIndex % spriteCache.petals.length;
            sprite = spriteCache.petals[spriteIndex];
            drawWidth = particle.size * 0.92;
            drawHeight = particle.size * 1.18;
            flipScale = 0.28 + Math.abs(Math.cos(particle.flipPhase)) * 0.72;
        } else if (particle.type === 'blossom') {
            sprite = spriteCache.blossom;
            drawWidth = particle.size;
            drawHeight = particle.size;
            flipScale = 0.78 + Math.abs(Math.cos(particle.flipPhase)) * 0.22;
        } else {
            const normalizedFlap = (particle.flapPhase % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
            const frame = Math.floor(normalizedFlap / (Math.PI * 2) * spriteCache.butterflies.length)
                % spriteCache.butterflies.length;
            sprite = spriteCache.butterflies[frame];
            drawWidth = particle.size * 1.36;
            drawHeight = particle.size;
        }

        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.scale(flipScale, 1);
        context.globalAlpha = particle.alpha;
        context.drawImage(sprite, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        context.restore();
    }

    function drawFrame() {
        clearAnimationCanvases();
        for (let index = 0; index < particles.length; index += 1) {
            const particle = particles[index];
            drawParticle(particle.layer === 'foreground' ? ctxFg : ctxBg, particle);
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

    rebuildSpriteCache();
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
            rebuildSpriteCache();
            resetPerformanceSampling();
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
