// ==========================================
// 2. 蝴蝶与樱花动画
// ==========================================
let bothOnline = false;
let sakuraColor = '#f2b8c0'; // Retained for compatibility with other logic if any
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

(function() {
    const canvasBg = document.getElementById('sakura-canvas');
    const canvasFg = document.getElementById('sakura-canvas-foreground');
    if (!canvasBg || !canvasFg) return;
    const ctxBg = canvasBg.getContext('2d');
    const ctxFg = canvasFg.getContext('2d');
    if (!ctxBg || !ctxFg) return;
    let particles = [];
    let canvasWidth = window.innerWidth;
    let canvasHeight = window.innerHeight;
    
    let isMobile = window.innerWidth < 768;
    const PARTICLE_COUNT = isMobile ? 6 : 15;

    // 蝴蝶多彩调色板
    const colors = [
        '#FF9A9E', '#A1C4FD', '#FDFBFB', '#FFECD2', 
        '#ACE0F9', '#FBC2EB', '#A6C1EE', '#FD999A',
        '#E2A9CE', '#FFD194', '#70E1F5', '#FFD1FF'
    ];

    function resize() {
        const previousWidth = canvasWidth;
        const previousHeight = canvasHeight;
        canvasWidth = Math.max(window.innerWidth, 1);
        canvasHeight = Math.max(window.innerHeight, 1);
        sizeAnimationCanvas(canvasBg, ctxBg, canvasWidth, canvasHeight);
        sizeAnimationCanvas(canvasFg, ctxFg, canvasWidth, canvasHeight);
        if (previousWidth > 0 && previousHeight > 0) {
            particles.forEach(particle => {
                particle.x = particle.x * canvasWidth / previousWidth;
                particle.y = particle.y * canvasHeight / previousHeight;
            });
        }
        isMobile = canvasWidth < 768;
    }
    resize();
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 200);
    });

    function newParticle(type, isForeground) {
        if (type === 'butterfly') {
            return {
                type: 'butterfly',
                isForeground: isForeground,
                x: Math.random() * canvasWidth,
                y: -30,
                size: 4 + Math.random() * 5,
                speedY: 1.5 + Math.random() * 2.5,
                speedX: -1.2 + Math.random() * 2.0,
                rot: (Math.random() - 0.5) * 0.6,
                rotSpeed: (Math.random() - 0.5) * 0.02,
                alpha: 0.6 + Math.random() * 0.4,
                sway: Math.random() * Math.PI * 2,
                swaySpeed: 0.015 + Math.random() * 0.02,
                color: colors[Math.floor(Math.random() * colors.length)],
                wingAngle: Math.random() * Math.PI * 2,
                wingSpeed: 0.15 + Math.random() * 0.25
            };
        } else {
            return {
                type: 'petal',
                isForeground: isForeground,
                x: Math.random() * canvasWidth,
                y: -20,
                size: 6 + Math.random() * 8,
                speedY: 1.2 + Math.random() * 2.0,
                speedX: (Math.random() - 0.5) * 1.5,
                rot: Math.random() * Math.PI * 2,
                rotSpeed: (Math.random() - 0.5) * 0.03,
                alpha: 0.5 + Math.random() * 0.4,
                sway: Math.random() * Math.PI * 2,
                swaySpeed: 0.008 + Math.random() * 0.01
            };
        }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const isForeground = i % 3 === 0; // 约 1/3 的粒子在前景，2/3 在背景
        const p = newParticle(i % 2 === 0 ? 'butterfly' : 'petal', isForeground);
        p.y = Math.random() * canvasHeight;
        particles.push(p);
    }

    function drawButterfly(ctx, b) {
        ctx.save();
        ctx.translate(b.x, b.y);
        const currentRot = b.rot + Math.sin(b.sway) * 0.2;
        ctx.rotate(currentRot);
        ctx.globalAlpha = b.alpha;
        
        const flap = Math.abs(Math.cos(b.wingAngle)); 
        
        ctx.fillStyle = b.color;
        if (bothOnline && !isMobile) {
            // 移除 shadowBlur 优化性能
        }

        ctx.save();
        ctx.scale(flap, 1);
        ctx.beginPath();
        ctx.ellipse(-b.size * 1.1, -b.size * 0.2, b.size * 1.2, b.size * 1.5, -Math.PI / 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(-b.size * 0.9, b.size * 1.2, b.size * 0.9, b.size * 1.1, Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.scale(flap, 1);
        ctx.beginPath();
        ctx.ellipse(b.size * 1.1, -b.size * 0.2, b.size * 1.2, b.size * 1.5, Math.PI / 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(b.size * 0.9, b.size * 1.2, b.size * 0.9, b.size * 1.1, -Math.PI / 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        
        ctx.fillStyle = 'rgba(120, 100, 100, 0.7)';
        ctx.beginPath();
        ctx.ellipse(0, b.size * 0.5, b.size * 0.2, b.size * 1.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function drawPetal(ctx, p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx.fillStyle = sakuraColor;
        if (bothOnline && !isMobile) {
            // 移除 shadowBlur 优化性能
        }
        ctx.fill();
        ctx.restore();
    }

    let animationFrameId = null;

    function clearAnimationCanvases() {
        ctxBg.clearRect(0, 0, canvasWidth, canvasHeight);
        ctxFg.clearRect(0, 0, canvasWidth, canvasHeight);
    }

    function shouldRunAnimation() {
        return !document.hidden && animationsReducedMotionQuery?.matches !== true;
    }

    function stopAnimation() {
        if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
        clearAnimationCanvases();
    }

    function animate() {
        animationFrameId = null;
        if (!shouldRunAnimation()) {
            clearAnimationCanvases();
            return;
        }
        particles.forEach((p, i) => {
            p.sway += p.swaySpeed * (bothOnline ? 1.5 : 1);
            
            if (p.type === 'butterfly') {
                p.wingAngle += p.wingSpeed * (bothOnline ? 1.5 : 1);
                const flapLift = Math.sin(p.wingAngle) * 0.6;
                
                p.x += p.speedX + Math.sin(p.sway) * (bothOnline ? 1.8 : 1.2);
                p.y += p.speedY * (bothOnline ? 1.3 : 1) - flapLift;
                p.rot += p.rotSpeed * (bothOnline ? 1.5 : 1);
                
                if (p.y > canvasHeight + 40 || p.x < -60 || p.x > canvasWidth + 60) {
                    particles[i] = newParticle('butterfly', p.isForeground);
                }
            } else {
                p.x += p.speedX + Math.sin(p.sway) * (bothOnline ? 0.8 : 0.5);
                p.y += p.speedY * (bothOnline ? 1.3 : 1);
                p.rot += p.rotSpeed * (bothOnline ? 1.5 : 1);
                
                if (p.y > canvasHeight + 20) {
                    particles[i] = newParticle('petal', p.isForeground);
                }
            }
        });
        clearAnimationCanvases();
        particles.forEach(p => {
            const ctx = p.isForeground ? ctxFg : ctxBg;
            if (p.type === 'butterfly') drawButterfly(ctx, p);
            else drawPetal(ctx, p);
        });
        animationFrameId = requestAnimationFrame(animate);
    }

    function startAnimation() {
        if (animationFrameId !== null || !shouldRunAnimation()) {
            if (!shouldRunAnimation()) stopAnimation();
            return;
        }
        animationFrameId = requestAnimationFrame(animate);
    }
    startAnimation();

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopAnimation();
        } else {
            startAnimation();
        }
    });

    const handleReducedMotionChange = () => {
        if (animationsReducedMotionQuery?.matches) stopAnimation();
        else startAnimation();
    };
    if (typeof animationsReducedMotionQuery?.addEventListener === 'function') {
        animationsReducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    } else if (typeof animationsReducedMotionQuery?.addListener === 'function') {
        animationsReducedMotionQuery.addListener(handleReducedMotionChange);
    }
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
