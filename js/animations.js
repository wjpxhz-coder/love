// ==========================================================================
// 现代电影景深浮屏水彩桃花雨引擎 (js/animations.js)
// - 4×3 单张离屏 Texture Atlas 预烘焙（3色水彩单瓣 / 五瓣桃花 / 双瓣并蒂 /
//   爱心花瓣 / 镜头柔焦虚化大花瓣 Bokeh Petal / 光学星尘）
// - 全屏单层浮屏 Canvas（浮于卡片之上、严格低于顶栏与弹窗，零毛玻璃冲突）
// - 薄纱半透明质感 + 矩阵直写 (setTransform) 取代每粒子 save/restore
// - 对象池零 GC 光学微涟漪与花瓣星屑 + 夜间 lighter 光学叠加 + 掉帧自保护
// - 支持三档氛围控制：dream(饱满景深桃花雨) / light(稀疏微风落花) / calm(静谧省电)
// ==========================================================================

(function initModernPeachRainEngine() {
    const reducedMotionQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const ATLAS_CELL = 128;
    const ATLAS_COLS = 4;
    const ATLAS_ROWS = 3;
    const MAX_DELTA_SEC = 0.05;
    const MOBILE_BREAKPOINT = 768;

    // ── 工具函数：读取全局氛围档位与硬件能力 ──
    function getAmbientMode() {
        const attr = document.documentElement.getAttribute('data-ambient');
        if (attr === 'dream' || attr === 'light' || attr === 'calm') return attr;
        try {
            const saved = localStorage.getItem('ambient_preference');
            if (saved === 'dream' || saved === 'light' || saved === 'calm') return saved;
        } catch (_e) {}
        if (navigator.connection?.saveData) return 'light';
        return 'dream';
    }

    function isLowPowerDevice() {
        const cores = navigator.hardwareConcurrency || 4;
        const mem = navigator.deviceMemory || 4;
        return Boolean(navigator.connection?.saveData) || cores <= 2 || mem <= 2;
    }

    function getCanvasDpr(isMobile) {
        const raw = Math.max(window.devicePixelRatio || 1, 1);
        if (isMobile) return Math.min(raw, 1.1);
        return isLowPowerDevice() ? Math.min(raw, 1.0) : Math.min(raw, 1.25);
    }

    // ── 轻奢薄纱水彩桃花色盘（低饱和高级通透，昼夜与同频在线自适应） ──
    function buildPalette(theme, bothOnline) {
        const isDark = theme === 'dark';
        if (isDark) {
            return {
                isDark: true,
                petals: [
                    { c1: 'rgba(255, 244, 248, 0.94)', c2: 'rgba(248, 168, 196, 0.88)', c3: 'rgba(218, 92, 138, 0.84)', vein: 'rgba(255, 234, 242, 0.56)' },
                    { c1: 'rgba(255, 238, 246, 0.92)', c2: 'rgba(232, 146, 196, 0.86)', c3: 'rgba(182, 86, 166, 0.82)', vein: 'rgba(252, 224, 244, 0.52)' },
                    { c1: 'rgba(255, 249, 238, 0.92)', c2: bothOnline ? 'rgba(253, 214, 130, 0.88)' : 'rgba(252, 182, 206, 0.88)', c3: bothOnline ? 'rgba(224, 144, 52, 0.84)' : 'rgba(202, 88, 132, 0.82)', vein: 'rgba(255, 242, 222, 0.54)' }
                ],
                blossomCore: bothOnline ? '#fcd34d' : '#fda4af',
                blossomPollen: bothOnline ? '#fef3c7' : '#ffffff',
                bokeh: [
                    { inner: 'rgba(251, 132, 166, 0.28)', mid: 'rgba(244, 114, 182, 0.14)', outer: 'rgba(244, 114, 182, 0)' },
                    { inner: bothOnline ? 'rgba(251, 191, 36, 0.26)' : 'rgba(196, 142, 252, 0.26)', mid: bothOnline ? 'rgba(251, 191, 36, 0.12)' : 'rgba(192, 132, 252, 0.12)', outer: 'rgba(192, 132, 252, 0)' }
                ],
                dust: [
                    { core: '#ffffff', mid: 'rgba(253, 196, 218, 0.78)', outer: 'rgba(244, 114, 182, 0.18)' },
                    { core: '#fffdf4', mid: bothOnline ? 'rgba(253, 224, 128, 0.88)' : 'rgba(216, 180, 254, 0.76)', outer: bothOnline ? 'rgba(251, 191, 36, 0.20)' : 'rgba(168, 85, 247, 0.18)' },
                    { core: '#ffffff', mid: 'rgba(255, 228, 236, 0.80)', outer: 'rgba(251, 113, 133, 0.16)' }
                ],
                rippleStroke: bothOnline ? 'rgba(253, 214, 138, 0.54)' : 'rgba(253, 164, 175, 0.50)',
                rippleFill: bothOnline ? 'rgba(251, 191, 36, 0.14)' : 'rgba(244, 114, 182, 0.14)',
                goldRim: bothOnline ? 'rgba(253, 224, 128, 0.50)' : null
            };
        }
        return {
            isDark: false,
            petals: [
                { c1: 'rgba(255, 236, 243, 0.94)', c2: 'rgba(255, 146, 180, 0.90)', c3: 'rgba(238, 72, 118, 0.88)', vein: 'rgba(255, 255, 255, 0.82)', rim: 'rgba(238, 72, 118, 0.16)' },
                { c1: 'rgba(255, 230, 240, 0.92)', c2: 'rgba(252, 162, 194, 0.90)', c3: 'rgba(224, 82, 138, 0.86)', vein: 'rgba(255, 255, 255, 0.84)', rim: 'rgba(224, 82, 138, 0.15)' },
                { c1: 'rgba(255, 244, 238, 0.92)', c2: bothOnline ? 'rgba(252, 200, 108, 0.90)' : 'rgba(218, 168, 250, 0.88)', c3: bothOnline ? 'rgba(224, 136, 36, 0.86)' : 'rgba(176, 98, 224, 0.84)', vein: 'rgba(255, 255, 255, 0.80)', rim: bothOnline ? 'rgba(224, 136, 36, 0.16)' : 'rgba(176, 98, 224, 0.15)' }
            ],
            blossomCore: bothOnline ? '#f59e0b' : '#f43f5e',
            blossomPollen: bothOnline ? '#fef08a' : '#ffffff',
            bokeh: [
                { inner: 'rgba(244, 96, 144, 0.34)', mid: 'rgba(252, 148, 184, 0.16)', outer: 'rgba(252, 148, 184, 0)' },
                { inner: bothOnline ? 'rgba(245, 166, 48, 0.32)' : 'rgba(186, 128, 246, 0.30)', mid: bothOnline ? 'rgba(252, 204, 114, 0.14)' : 'rgba(208, 168, 250, 0.14)', outer: 'rgba(208, 168, 250, 0)' }
            ],
            dust: [
                { core: '#fff5f8', mid: 'rgba(244, 96, 144, 0.78)', outer: 'rgba(244, 63, 94, 0.18)' },
                { core: '#fffdf2', mid: bothOnline ? 'rgba(245, 158, 11, 0.84)' : 'rgba(182, 116, 246, 0.76)', outer: bothOnline ? 'rgba(245, 158, 11, 0.20)' : 'rgba(168, 85, 247, 0.16)' },
                { core: '#ffffff', mid: 'rgba(251, 132, 166, 0.78)', outer: 'rgba(244, 114, 182, 0.16)' }
            ],
            rippleStroke: bothOnline ? 'rgba(245, 158, 11, 0.52)' : 'rgba(244, 63, 94, 0.48)',
            rippleFill: bothOnline ? 'rgba(251, 191, 36, 0.15)' : 'rgba(251, 113, 133, 0.16)',
            goldRim: bothOnline ? 'rgba(245, 176, 62, 0.46)' : null
        };
    }

    // 绘制一片标准水彩桃花单瓣（带顶端温柔微缺口 + 脉纹）
    function drawWatercolorPetalShape(c, s, shade, goldRim) {
        c.beginPath();
        c.moveTo(0, 0);
        c.bezierCurveTo(-s * 0.88, -s * 0.48, -s * 0.76, -s * 1.44, -s * 0.14, -s * 1.72);
        c.quadraticCurveTo(0, -s * 1.50, s * 0.14, -s * 1.72);
        c.bezierCurveTo(s * 0.76, -s * 1.44, s * 0.88, -s * 0.48, 0, 0);
        c.closePath();

        const grad = c.createRadialGradient(0, -s * 0.35, 1, 0, -s * 0.95, s * 1.38);
        grad.addColorStop(0, shade.c1);
        grad.addColorStop(0.56, shade.c2);
        grad.addColorStop(1, shade.c3);
        c.fillStyle = grad;
        c.fill();

        // 柔和丝绸内高光
        c.beginPath();
        c.moveTo(-s * 0.08, -s * 0.22);
        c.bezierCurveTo(-s * 0.46, -s * 0.56, -s * 0.40, -s * 1.18, -s * 0.10, -s * 1.36);
        c.bezierCurveTo(-s * 0.22, -s * 1.02, -s * 0.22, -s * 0.58, -s * 0.08, -s * 0.22);
        c.fillStyle = 'rgba(255, 255, 255, 0.26)';
        c.fill();

        // 纤细中心脉纹
        c.beginPath();
        c.moveTo(0, -s * 0.14);
        c.quadraticCurveTo(s * 0.05, -s * 0.78, 0, -s * 1.34);
        c.strokeStyle = shade.vein;
        c.lineWidth = Math.max(0.9, s * 0.032);
        c.lineCap = 'round';
        c.stroke();

        if (goldRim) {
            c.strokeStyle = goldRim;
            c.lineWidth = 1.1;
            c.stroke();
        } else if (shade.rim) {
            c.strokeStyle = shade.rim;
            c.lineWidth = 1.0;
            c.stroke();
        }
    }

    // ── 单张离屏 Texture Atlas 预烘焙（4×3 共 12 种电影景深水彩材质） ──
    const atlasCache = new Map();

    function getSharedAtlas(theme, bothOnline) {
        const key = `${theme === 'dark' ? 'dark' : 'light'}_${bothOnline ? '1' : '0'}`;
        if (atlasCache.has(key)) return atlasCache.get(key);

        const palette = buildPalette(theme, bothOnline);
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(ATLAS_CELL * ATLAS_COLS * dpr);
        canvas.height = Math.round(ATLAS_CELL * ATLAS_ROWS * dpr);
        const ctx = canvas.getContext('2d');
        if (!ctx) return { canvas, palette, dpr, cellPx: Math.round(ATLAS_CELL * dpr) };

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const drawSlot = (col, row, fn) => {
            ctx.save();
            ctx.translate(col * ATLAS_CELL + ATLAS_CELL * 0.5, row * ATLAS_CELL + ATLAS_CELL * 0.5);
            fn(ctx);
            ctx.restore();
        };

        // Row 0, Col 0..2：3 种水彩半透明单瓣桃花
        for (let i = 0; i < 3; i++) {
            const shade = palette.petals[i];
            drawSlot(i, 0, (c) => {
                c.translate(0, 30);
                drawWatercolorPetalShape(c, 36, shade, palette.goldRim);
            });
        }

        // Row 0, Col 3：盛开五瓣小桃花
        drawSlot(3, 0, (c) => {
            const shade = palette.petals[0];
            const bs = 27;
            for (let b = 0; b < 5; b++) {
                c.save();
                c.rotate((b * Math.PI * 2) / 5);
                c.beginPath();
                c.moveTo(0, 0);
                c.bezierCurveTo(-bs * 0.54, -bs * 0.36, -bs * 0.48, -bs * 1.00, -bs * 0.08, -bs * 1.18);
                c.quadraticCurveTo(0, -bs * 1.04, bs * 0.08, -bs * 1.18);
                c.bezierCurveTo(bs * 0.48, -bs * 1.00, bs * 0.54, -bs * 0.36, 0, 0);
                const g = c.createRadialGradient(0, -bs * 0.2, 1, 0, -bs * 0.68, bs * 1.05);
                g.addColorStop(0, shade.c1);
                g.addColorStop(0.58, shade.c2);
                g.addColorStop(1, shade.c3);
                c.fillStyle = g;
                c.fill();
                c.restore();
            }
            // 花蕊核心与花粉点
            c.beginPath();
            c.arc(0, 0, 5.2, 0, Math.PI * 2);
            c.fillStyle = palette.blossomCore;
            c.fill();
            for (let d = 0; d < 5; d++) {
                const a = (d * Math.PI * 2) / 5 + 0.3;
                c.beginPath();
                c.arc(Math.cos(a) * 9.6, Math.sin(a) * 9.6, 1.5, 0, Math.PI * 2);
                c.fillStyle = palette.blossomPollen;
                c.fill();
            }
        });

        // Row 1, Col 0..1：2 种双瓣并蒂落花
        for (let i = 0; i < 2; i++) {
            const s1 = palette.petals[i];
            const s2 = palette.petals[(i + 1) % 3];
            drawSlot(i, 1, (c) => {
                c.translate(0, 22);
                c.save();
                c.rotate(-0.38);
                drawWatercolorPetalShape(c, 27, s1, palette.goldRim);
                c.restore();
                c.save();
                c.rotate(0.32);
                c.translate(2, 2);
                drawWatercolorPetalShape(c, 24, s2, palette.goldRim);
                c.restore();
            });
        }

        // Row 1, Col 2：精致水彩爱心桃花瓣
        drawSlot(2, 1, (c) => {
            const shade = palette.petals[0];
            const hs = 28;
            c.beginPath();
            c.moveTo(0, hs * 0.78);
            c.bezierCurveTo(-hs * 1.28, -hs * 0.22, -hs * 0.84, -hs * 1.18, 0, -hs * 0.44);
            c.bezierCurveTo(hs * 0.84, -hs * 1.18, hs * 1.28, -hs * 0.22, 0, hs * 0.78);
            c.closePath();

            const hg = c.createRadialGradient(-hs * 0.2, -hs * 0.25, 2, 0, 0, hs * 1.22);
            hg.addColorStop(0, shade.c1);
            hg.addColorStop(0.55, shade.c2);
            hg.addColorStop(1, shade.c3);
            c.fillStyle = hg;
            c.fill();

            // 柔润高光点
            c.fillStyle = 'rgba(255, 255, 255, 0.35)';
            c.beginPath();
            c.ellipse(-hs * 0.36, -hs * 0.30, hs * 0.18, hs * 0.10, -0.5, 0, Math.PI * 2);
            c.fill();
        });

        // Row 1, Col 3：柔光星尘 (1)
        const drawDustSlot = (col, row, ds) => {
            drawSlot(col, row, (c) => {
                const rad = 40;
                const grad = c.createRadialGradient(0, 0, 0, 0, 0, rad);
                grad.addColorStop(0, ds.core);
                grad.addColorStop(0.18, ds.mid);
                grad.addColorStop(0.50, ds.outer);
                grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                c.fillStyle = grad;
                c.beginPath();
                c.arc(0, 0, rad, 0, Math.PI * 2);
                c.fill();

                c.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                c.lineWidth = 1.2;
                c.beginPath();
                c.moveTo(-11, 0);
                c.lineTo(11, 0);
                c.moveTo(0, -11);
                c.lineTo(0, 11);
                c.stroke();
            });
        };
        drawDustSlot(3, 1, palette.dust[0]);

        // Row 2, Col 0..1：2 种镜头近景柔焦虚化大花瓣 (Bokeh Petal，多层羽化轮廓，零实时滤镜)
        for (let i = 0; i < 2; i++) {
            const bk = palette.bokeh[i];
            drawSlot(i, 2, (c) => {
                // 通过 4 层渐扩半透明花瓣轮廓叠加出自然摄影失焦感
                const layers = [
                    { scale: 1.18, alpha: 0.24 },
                    { scale: 1.04, alpha: 0.36 },
                    { scale: 0.90, alpha: 0.52 },
                    { scale: 0.74, alpha: 0.65 }
                ];
                c.translate(0, 26);
                for (let l = 0; l < layers.length; l++) {
                    const sc = layers[l].scale;
                    const s = 34 * sc;
                    c.save();
                    c.globalAlpha = layers[l].alpha;
                    c.beginPath();
                    c.moveTo(0, 0);
                    c.bezierCurveTo(-s * 0.92, -s * 0.48, -s * 0.80, -s * 1.44, 0, -s * 1.66);
                    c.bezierCurveTo(s * 0.80, -s * 1.44, s * 0.92, -s * 0.48, 0, 0);
                    c.closePath();

                    const bg = c.createRadialGradient(0, -s * 0.75, 2, 0, -s * 0.75, s * 1.15);
                    bg.addColorStop(0, bk.inner);
                    bg.addColorStop(0.55, bk.mid);
                    bg.addColorStop(1, bk.outer);
                    c.fillStyle = bg;
                    c.fill();
                    c.restore();
                }
            });
        }

        // Row 2, Col 2..3：微光星尘 (2, 3)
        drawDustSlot(2, 2, palette.dust[1]);
        drawDustSlot(3, 2, palette.dust[2]);

        const entry = {
            canvas,
            palette,
            dpr,
            cellPx: Math.round(ATLAS_CELL * dpr)
        };
        atlasCache.set(key, entry);
        return entry;
    }

    // ── 通用电影景深浮屏桃花雨控制器工厂（首页 / 登录页 / 个人主页统一复用） ──
    function createAtmosphericCanvasController(canvas, options = {}) {
        const ctx = canvas?.getContext('2d', { alpha: true });
        if (!canvas || !ctx) return null;

        const config = {
            desktopCount: options.desktopCount || 32,
            mobileCount: options.mobileCount || 18,
            lightDesktopCount: options.lightDesktopCount || 10,
            lightMobileCount: options.lightMobileCount || 7,
            enablePointerWind: options.enablePointerWind !== false,
            scrollThrottle: options.scrollThrottle !== false,
            initialRouteActive: Boolean(options.initialRouteActive),
            alwaysDarkTone: Boolean(options.alwaysDarkTone),
            baseWind: typeof options.baseWind === 'number' ? options.baseWind : 0.92
        };

        let width = Math.max(window.innerWidth, 1);
        let height = Math.max(window.innerHeight, 1);
        let isMobile = width < MOBILE_BREAKPOINT;
        let dpr = getCanvasDpr(isMobile);

        let routeActive = config.initialRouteActive;
        const suspendReasons = new Set();
        let ambientMode = getAmbientMode();
        let qualityScale = isLowPowerDevice() ? 0.68 : 1.0;

        let appearance = {
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            bothOnline: false
        };
        let atlasEntry = getSharedAtlas(
            config.alwaysDarkTone ? 'dark' : appearance.theme,
            appearance.bothOnline
        );

        let rafId = null;
        let lastTimestamp = 0;
        let simTime = 0;
        let resizeTimer = null;
        let isUserScrolling = false;
        let scrollDebounceTimer = null;

        // 帧耗时滑动监控（自动掉帧保护）
        let slowFrameSum = 0;
        let slowFrameCount = 0;
        let degradeStrikes = 0;
        let autoDegradedOff = false;

        // 鼠标拂风交互（节流 ~38Hz）
        const pointer = {
            x: -2000,
            y: -2000,
            vx: 0,
            vy: 0,
            lastX: 0,
            lastY: 0,
            lastTime: 0,
            active: false
        };

        // 常驻桃花雨粒子池 + 一键想你临时加速花雨粒子
        const particles = [];
        const gustPetals = [];
        const MAX_GUST_PETALS = 26;

        // 光学微涟漪对象池
        const MAX_RIPPLES = 8;
        const ripples = Array.from({ length: MAX_RIPPLES }, () => ({
            active: false,
            x: 0,
            y: 0,
            age: 0,
            duration: 0.72,
            maxRadius: 54
        }));

        // 点击散开水彩桃花瓣与微光星屑对象池
        const MAX_SPARKS = 64;
        const sparks = Array.from({ length: MAX_SPARKS }, () => ({
            active: false,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            size: 0.16,
            angle: 0,
            angleSpeed: 0,
            flip: 0,
            flipSpeed: 0,
            life: 0,
            decay: 0.015,
            slotCol: 0,
            slotRow: 0,
            isAdditive: false
        }));

        // 按斜风投影权重均匀注入屏幕顶部与迎风左侧
        function placeWindwardSpawn(p, vy, initSpawn) {
            if (initSpawn) {
                p.x = Math.random() * width;
                p.y = Math.random() * height;
                return;
            }
            const wind = config.baseWind;
            const drift = Math.abs(wind) * (height / Math.max(0.7, vy));
            if (wind >= 0.15) {
                const leftWeight = height;
                const topWeight = width + drift;
                if (Math.random() * (leftWeight + topWeight) < leftWeight) {
                    p.x = -24 - Math.random() * 55;
                    p.y = Math.random() * (height + 40) - 20;
                } else {
                    p.x = Math.random() * (width + drift) - drift * 0.65;
                    p.y = -24 - Math.random() * 60;
                }
            } else {
                p.x = Math.random() * (width + 100) - 50;
                p.y = -24 - Math.random() * 60;
            }
        }

        function assignPetalVisual(p, forceKind = null) {
            const darkTone = appearance.theme === 'dark' || config.alwaysDarkTone;
            const roll = Math.random();
            let kind = forceKind;
            if (!kind) {
                if (roll < 0.52) kind = 'petal';
                else if (roll < 0.66) kind = 'twin';
                else if (roll < 0.76) kind = 'blossom';
                else if (roll < 0.81) kind = 'heart';
                else if (roll < 0.90) kind = 'bokeh';
                else kind = 'dust';
            }
            p.kind = kind;

            if (kind === 'petal') {
                p.slotCol = Math.floor(Math.random() * 3);
                p.slotRow = 0;
                p.isAdditive = false;
                p.size = isMobile ? (0.20 + Math.random() * 0.11) : (0.23 + Math.random() * 0.14);
                p.vy = 0.85 + Math.random() * 1.15;
                p.vx = (Math.random() - 0.5) * 0.45;
                p.opacity = darkTone ? (0.54 + Math.random() * 0.28) : (0.64 + Math.random() * 0.24);
            } else if (kind === 'twin') {
                p.slotCol = Math.random() < 0.5 ? 0 : 1;
                p.slotRow = 1;
                p.isAdditive = false;
                p.size = isMobile ? (0.23 + Math.random() * 0.10) : (0.26 + Math.random() * 0.13);
                p.vy = 0.80 + Math.random() * 1.02;
                p.vx = (Math.random() - 0.5) * 0.42;
                p.opacity = darkTone ? (0.52 + Math.random() * 0.26) : (0.62 + Math.random() * 0.22);
            } else if (kind === 'blossom') {
                p.slotCol = 3;
                p.slotRow = 0;
                p.isAdditive = false;
                p.size = isMobile ? (0.20 + Math.random() * 0.10) : (0.24 + Math.random() * 0.12);
                p.vy = 0.74 + Math.random() * 0.94;
                p.vx = (Math.random() - 0.5) * 0.38;
                p.opacity = darkTone ? (0.54 + Math.random() * 0.26) : (0.62 + Math.random() * 0.24);
            } else if (kind === 'heart') {
                p.slotCol = 2;
                p.slotRow = 1;
                p.isAdditive = false;
                p.size = isMobile ? (0.18 + Math.random() * 0.08) : (0.21 + Math.random() * 0.10);
                p.vy = 0.78 + Math.random() * 0.96;
                p.vx = (Math.random() - 0.5) * 0.4;
                p.opacity = darkTone ? (0.52 + Math.random() * 0.24) : (0.60 + Math.random() * 0.22);
            } else if (kind === 'bokeh') {
                // 近景镜头柔焦虚化大花瓣（薄纱低透明度，飘过卡片前方拉出电影景深）
                p.slotCol = Math.random() < 0.62 ? 0 : 1;
                p.slotRow = 2;
                p.isAdditive = false;
                p.size = isMobile ? (0.42 + Math.random() * 0.22) : (0.54 + Math.random() * 0.30);
                p.vy = 1.18 + Math.random() * 1.25;
                p.vx = (Math.random() - 0.5) * 0.55;
                p.opacity = darkTone ? (0.30 + Math.random() * 0.16) : (0.36 + Math.random() * 0.18);
            } else {
                // 细腻微光星尘
                const dPick = Math.random();
                if (dPick < 0.34) { p.slotCol = 3; p.slotRow = 1; }
                else if (dPick < 0.68) { p.slotCol = 2; p.slotRow = 2; }
                else { p.slotCol = 3; p.slotRow = 2; }
                p.isAdditive = true;
                p.size = isMobile ? (0.15 + Math.random() * 0.10) : (0.18 + Math.random() * 0.12);
                p.vy = -(0.16 + Math.random() * 0.28);
                p.vx = (Math.random() - 0.5) * 0.26;
                p.opacity = darkTone ? (0.46 + Math.random() * 0.38) : (0.42 + Math.random() * 0.32);
            }

            p.angle = Math.random() * Math.PI * 2;
            p.angleSpeed = (Math.random() - 0.5) * (kind === 'bokeh' ? 0.015 : 0.028);
            p.flip = Math.random() * Math.PI * 2;
            p.flipSpeed = 0.018 + Math.random() * 0.032;
            p.sway = Math.random() * Math.PI * 2;
            p.swaySpeed = 0.016 + Math.random() * 0.024;
            p.swayAmp = kind === 'dust' ? (0.24 + Math.random() * 0.26) : (0.55 + Math.random() * 0.78);
        }

        function resetParticle(p, initSpawn) {
            assignPetalVisual(p);
            if (p.kind === 'dust') {
                p.x = Math.random() * width;
                p.y = initSpawn ? Math.random() * height : height + 24 + Math.random() * 40;
            } else {
                placeWindwardSpawn(p, p.vy, initSpawn);
            }
        }

        function getTargetCount() {
            const isLight = ambientMode === 'light';
            const base = isLight
                ? (isMobile ? config.lightMobileCount : config.lightDesktopCount)
                : (isMobile ? config.mobileCount : config.desktopCount);
            return Math.max(4, Math.round(base * qualityScale));
        }

        function syncPopulation(forceRebuild = false) {
            const target = getTargetCount();
            if (forceRebuild) particles.length = 0;
            while (particles.length < target) {
                const p = {};
                resetParticle(p, true);
                particles.push(p);
            }
            if (particles.length > target) {
                particles.length = target;
            }
        }

        function sizeCanvas() {
            const prevW = width;
            const prevH = height;
            const prevMobile = isMobile;
            width = Math.max(window.innerWidth, 1);
            height = Math.max(window.innerHeight, 1);
            isMobile = width < MOBILE_BREAKPOINT;
            dpr = getCanvasDpr(isMobile);

            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';

            if (prevMobile !== isMobile) {
                syncPopulation(true);
            } else if (prevW > 0 && prevH > 0) {
                const rx = width / prevW;
                const ry = height / prevH;
                for (let i = 0; i < particles.length; i++) {
                    particles[i].x *= rx;
                    particles[i].y *= ry;
                }
            }
            syncPopulation();
        }

        function clearCanvas() {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        function shouldRun() {
            return routeActive
                && suspendReasons.size === 0
                && !document.hidden
                && !autoDegradedOff
                && ambientMode !== 'calm'
                && reducedMotionQuery?.matches !== true;
        }

        function stop(keepLastFrame = false) {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            lastTimestamp = 0;
            if (scrollDebounceTimer) {
                clearTimeout(scrollDebounceTimer);
                scrollDebounceTimer = null;
            }
            isUserScrolling = false;
            if (!keepLastFrame) {
                clearCanvas();
            }
        }

        function start() {
            if (rafId !== null || !shouldRun()) return;
            lastTimestamp = 0;
            slowFrameSum = 0;
            slowFrameCount = 0;
            rafId = requestAnimationFrame(loop);
        }

        function reconcile() {
            if (shouldRun()) {
                start();
            } else {
                // 切屏过渡挂起时保留最后一帧画面，由 CSS opacity 柔和淡出，消除第 0ms 花瓣全屏瞬灭闪烁
                const onlySuspendedWhileActive = routeActive
                    && ambientMode !== 'calm'
                    && reducedMotionQuery?.matches !== true
                    && suspendReasons.size > 0;
                stop(onlySuspendedWhileActive);
            }
        }

        // 点击空白处：光学微涟漪 + 8~12 片轻盈散开的水彩桃花瓣与微光星屑
        function spawnRippleAndPetals(x, y, burstCount = 10, optionsOverride = {}) {
            if (!shouldRun()) return;

            if (!optionsOverride.skipRipple) {
                const slot = ripples.find(r => !r.active) || ripples[0];
                slot.active = true;
                slot.x = x;
                slot.y = y;
                slot.age = 0;
                slot.duration = optionsOverride.rippleDuration || 0.72;
                slot.maxRadius = optionsOverride.rippleRadius || (isMobile ? 46 : 58);
            }

            const count = Math.min(burstCount, isMobile ? 10 : 14);
            const petalRatio = typeof optionsOverride.petalRatio === 'number' ? optionsOverride.petalRatio : 0.70;
            let spawned = 0;

            for (let i = 0; i < MAX_SPARKS && spawned < count; i++) {
                const sp = sparks[i];
                if (sp.active) continue;

                const angle = (Math.PI * 2 * spawned) / count + (Math.random() - 0.5) * 0.55;
                const speed = (optionsOverride.speedMin || 1.8) + Math.random() * (optionsOverride.speedSpan || 3.8);
                sp.active = true;
                sp.x = x;
                sp.y = y;
                sp.vx = Math.cos(angle) * speed;
                sp.vy = Math.sin(angle) * speed - (optionsOverride.lift || 1.25);
                sp.life = 1.0;
                sp.decay = 0.012 + Math.random() * 0.011;
                sp.angle = Math.random() * Math.PI * 2;
                sp.angleSpeed = (Math.random() - 0.5) * 0.08;
                sp.flip = Math.random() * Math.PI * 2;
                sp.flipSpeed = 0.05 + Math.random() * 0.04;

                if (Math.random() < petalRatio) {
                    const pType = Math.random();
                    if (pType < 0.65) {
                        sp.slotCol = Math.floor(Math.random() * 3);
                        sp.slotRow = 0;
                    } else if (pType < 0.85) {
                        sp.slotCol = 3;
                        sp.slotRow = 0;
                    } else {
                        sp.slotCol = 2;
                        sp.slotRow = 1;
                    }
                    sp.size = isMobile ? (0.18 + Math.random() * 0.09) : (0.21 + Math.random() * 0.10);
                    sp.isAdditive = false;
                } else {
                    sp.slotCol = Math.random() < 0.5 ? 2 : 3;
                    sp.slotRow = 2;
                    sp.size = 0.14 + Math.random() * 0.10;
                    sp.isAdditive = true;
                }
                spawned++;
            }
        }

        // 一键想你呼应：3 处轻柔花瓣涟漪绽放 + 一波自然迎风加速花雨（飘出屏幕自动回收）
        function triggerFlutter() {
            if (!shouldRun()) return;
            const cx = width * 0.5;
            const cy = height * 0.42;

            spawnRippleAndPetals(cx, cy, isMobile ? 8 : 12, {
                rippleRadius: isMobile ? 76 : 108,
                rippleDuration: 1.0,
                speedMin: 2.2,
                speedSpan: 4.4,
                lift: 1.6,
                petalRatio: 0.72
            });
            spawnRippleAndPetals(width * 0.25, height * 0.52, isMobile ? 6 : 9, {
                skipRipple: true,
                speedMin: 2.0,
                speedSpan: 3.6,
                lift: 1.5,
                petalRatio: 0.75
            });
            spawnRippleAndPetals(width * 0.75, height * 0.52, isMobile ? 6 : 9, {
                skipRipple: true,
                speedMin: 2.0,
                speedSpan: 3.6,
                lift: 1.5,
                petalRatio: 0.75
            });

            // 注入一波浪漫迎风加速水彩桃花瓣（随自然飞出屏幕自动回收，零生硬消失）
            const extraCount = ambientMode === 'light'
                ? (isMobile ? 6 : 10)
                : (isMobile ? 11 : 18);

            for (let i = 0; i < extraCount && gustPetals.length < MAX_GUST_PETALS; i++) {
                const gp = {};
                const r = Math.random();
                const kind = r < 0.60 ? 'petal' : (r < 0.78 ? 'twin' : (r < 0.90 ? 'blossom' : 'heart'));
                assignPetalVisual(gp, kind);
                gp.vy *= 1.48;
                gp.vx += 0.45 + Math.random() * 0.55;
                gp.opacity = Math.min(0.88, gp.opacity + 0.10);
                gp.x = Math.random() * (width + 180) - 120;
                gp.y = -24 - Math.random() * (height * 0.42);
                gustPetals.push(gp);
            }
        }

        function updateSinglePetal(p, step, globalWind, isGust) {
            p.sway += p.swaySpeed * step;
            p.flip += p.flipSpeed * step;
            p.angle += p.angleSpeed * step;

            const osc = Math.sin(p.sway) * p.swayAmp;
            let vx = p.vx + (p.kind === 'dust' ? osc * 0.75 : globalWind + osc);
            let vy = p.vy;

            // 桌面端鼠标轻拂微风
            if (config.enablePointerWind && pointer.active && p.kind !== 'bokeh') {
                const dx = p.x - pointer.x;
                const dy = p.y - pointer.y;
                const distSq = dx * dx + dy * dy;
                const maxR = 175;
                if (distSq < maxR * maxR && distSq > 4) {
                    const dist = Math.sqrt(distSq);
                    const f = (maxR - dist) / maxR;
                    vx += (dx / dist) * f * 3.4 + pointer.vx * 0.16;
                    vy += (dy / dist) * f * 3.4 + pointer.vy * 0.16;
                }
            }

            p.x += vx * step;
            p.y += vy * step;

            if (p.kind === 'dust') {
                return p.y < -36 || p.x < -70 || p.x > width + 70;
            }
            const outY = p.y > height + 72;
            const outX = p.x > width + 110 || p.x < -220;
            if (outY || outX) {
                if (!isGust) resetParticle(p, false);
                return true;
            }
            return false;
        }

        function update(dtSec) {
            simTime += dtSec;
            const step = dtSec * 60;
            const globalWind = config.baseWind + Math.sin(simTime * 0.65) * 0.30 + Math.cos(simTime * 0.28) * 0.18;

            for (let i = 0; i < particles.length; i++) {
                const out = updateSinglePetal(particles[i], step, globalWind, false);
                if (out && particles[i].kind === 'dust') {
                    resetParticle(particles[i], false);
                }
            }

            for (let i = gustPetals.length - 1; i >= 0; i--) {
                if (updateSinglePetal(gustPetals[i], step, globalWind * 1.15, true)) {
                    gustPetals.splice(i, 1);
                }
            }

            for (let i = 0; i < MAX_RIPPLES; i++) {
                const r = ripples[i];
                if (!r.active) continue;
                r.age += dtSec;
                if (r.age >= r.duration) r.active = false;
            }

            const drag = Math.pow(0.955, step);
            for (let i = 0; i < MAX_SPARKS; i++) {
                const sp = sparks[i];
                if (!sp.active) continue;
                sp.x += sp.vx * step;
                sp.y += sp.vy * step;
                sp.vx *= drag;
                sp.vy *= drag;
                sp.vy += 0.055 * step; // 轻盈重力沉降
                sp.angle += sp.angleSpeed * step;
                sp.flip += sp.flipSpeed * step;
                sp.life -= sp.decay * step;
                if (sp.life <= 0) sp.active = false;
            }

            if (pointer.active) {
                pointer.vx *= 0.91;
                pointer.vy *= 0.91;
                if (performance.now() - pointer.lastTime > 520) {
                    pointer.active = false;
                }
            }
        }

        function drawParticleSprite(p, atlasImg, cellPx, halfCell) {
            const cos = Math.cos(p.angle);
            const sin = Math.sin(p.angle);
            let sx = p.size;
            let sy = p.size;
            let alpha = p.opacity;

            if (p.kind === 'petal' || p.kind === 'twin' || p.kind === 'heart') {
                const f = Math.sin(p.flip);
                sx *= (f >= 0 ? Math.max(0.24, f) : Math.min(-0.24, f));
            } else if (p.kind === 'blossom') {
                const f = 0.62 + Math.abs(Math.sin(p.flip * 0.8)) * 0.38;
                sx *= f;
            } else if (p.kind === 'dust') {
                const breath = 0.70 + Math.sin(p.sway * 1.8) * 0.30;
                sx *= breath;
                sy *= breath;
                alpha *= (0.62 + 0.38 * breath);
            }

            ctx.globalAlpha = alpha;
            ctx.setTransform(
                cos * sx * dpr,
                sin * sx * dpr,
                -sin * sy * dpr,
                cos * sy * dpr,
                p.x * dpr,
                p.y * dpr
            );
            ctx.drawImage(
                atlasImg,
                p.slotCol * cellPx,
                p.slotRow * cellPx,
                cellPx,
                cellPx,
                -halfCell,
                -halfCell,
                ATLAS_CELL,
                ATLAS_CELL
            );
        }

        function draw() {
            clearCanvas();

            const atlasImg = atlasEntry.canvas;
            const cellPx = atlasEntry.cellPx;
            const halfCell = ATLAS_CELL * 0.5;
            const useAdditive = atlasEntry.palette.isDark;

            // Pass 1：主水彩半透明桃花雨（普通混合，清晰通透不糊字）
            ctx.globalCompositeOperation = 'source-over';
            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];
                if (useAdditive && p.isAdditive) continue;
                drawParticleSprite(p, atlasImg, cellPx, halfCell);
            }
            for (let i = 0; i < gustPetals.length; i++) {
                drawParticleSprite(gustPetals[i], atlasImg, cellPx, halfCell);
            }

            // 点击散开的半透明水彩桃花瓣
            for (let i = 0; i < MAX_SPARKS; i++) {
                const sp = sparks[i];
                if (!sp.active || (useAdditive && sp.isAdditive)) continue;
                const cos = Math.cos(sp.angle);
                const sin = Math.sin(sp.angle);
                const f = Math.sin(sp.flip);
                const flipScale = f >= 0 ? Math.max(0.28, f) : Math.min(-0.28, f);
                const baseScale = sp.size * (0.48 + 0.52 * sp.life);
                const sx = sp.isAdditive ? baseScale : baseScale * flipScale;
                const sy = baseScale;
                ctx.globalAlpha = Math.max(0, Math.min(0.92, sp.life));
                ctx.setTransform(
                    cos * sx * dpr,
                    sin * sx * dpr,
                    -sin * sy * dpr,
                    cos * sy * dpr,
                    sp.x * dpr,
                    sp.y * dpr
                );
                ctx.drawImage(
                    atlasImg,
                    sp.slotCol * cellPx,
                    sp.slotRow * cellPx,
                    cellPx,
                    cellPx,
                    -halfCell,
                    -halfCell,
                    ATLAS_CELL,
                    ATLAS_CELL
                );
            }

            // Pass 2：深色模式光学叠加微光星尘（lighter 真实星光感）
            if (useAdditive) {
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < particles.length; i++) {
                    const p = particles[i];
                    if (!p.isAdditive) continue;
                    drawParticleSprite(p, atlasImg, cellPx, halfCell);
                }
                for (let i = 0; i < MAX_SPARKS; i++) {
                    const sp = sparks[i];
                    if (!sp.active || !sp.isAdditive) continue;
                    const s = sp.size * (0.5 + 0.5 * sp.life);
                    ctx.globalAlpha = Math.max(0, Math.min(1, sp.life));
                    ctx.setTransform(s * dpr, 0, 0, s * dpr, sp.x * dpr, sp.y * dpr);
                    ctx.drawImage(
                        atlasImg,
                        sp.slotCol * cellPx,
                        sp.slotRow * cellPx,
                        cellPx,
                        cellPx,
                        -halfCell,
                        -halfCell,
                        ATLAS_CELL,
                        ATLAS_CELL
                    );
                }
            }

            // Pass 3：点击光学微涟漪环
            let hasRipples = false;
            for (let i = 0; i < MAX_RIPPLES; i++) {
                if (ripples[i].active) { hasRipples = true; break; }
            }
            if (hasRipples) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                ctx.globalCompositeOperation = useAdditive ? 'lighter' : 'source-over';
                for (let i = 0; i < MAX_RIPPLES; i++) {
                    const r = ripples[i];
                    if (!r.active) continue;
                    const progress = Math.min(1, r.age / r.duration);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const radius = 6 + eased * r.maxRadius;
                    const alpha = (1 - progress) * (1 - progress);

                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
                    ctx.strokeStyle = atlasEntry.palette.rippleStroke;
                    ctx.lineWidth = Math.max(0.6, 1.8 * (1 - progress));
                    ctx.stroke();

                    if (progress < 0.55) {
                        ctx.globalAlpha = alpha * 0.6;
                        ctx.beginPath();
                        ctx.arc(r.x, r.y, radius * 0.52, 0, Math.PI * 2);
                        ctx.fillStyle = atlasEntry.palette.rippleFill;
                        ctx.fill();
                    }
                }
            }

            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }

        function loop(timestamp) {
            rafId = null;
            if (!shouldRun()) {
                stop();
                return;
            }

            // 滑动时让位至 ~30fps，平时平稳锁定 <= 60fps
            const minFrameMs = (config.scrollThrottle && isUserScrolling) ? 32 : 14;
            if (lastTimestamp > 0 && timestamp - lastTimestamp < minFrameMs) {
                rafId = requestAnimationFrame(loop);
                return;
            }

            const rawDt = lastTimestamp > 0 ? (timestamp - lastTimestamp) / 1000 : 0.016;
            const dtSec = Math.min(rawDt, MAX_DELTA_SEC);
            lastTimestamp = timestamp;

            // 运行时自适应掉帧保护
            if (!isUserScrolling && rawDt > 0.005 && rawDt < 0.2) {
                slowFrameSum += rawDt;
                slowFrameCount += 1;
                if (slowFrameCount >= 28) {
                    const avgDt = slowFrameSum / slowFrameCount;
                    slowFrameSum = 0;
                    slowFrameCount = 0;
                    if (avgDt > 0.032) {
                        degradeStrikes += 1;
                        if (degradeStrikes === 1 && qualityScale > 0.55) {
                            qualityScale = 0.52;
                            syncPopulation();
                        } else if (degradeStrikes >= 3) {
                            autoDegradedOff = true;
                            stop();
                            return;
                        }
                    } else if (degradeStrikes > 0) {
                        degradeStrikes = 0;
                    }
                }
            }

            update(dtSec);
            draw();

            if (shouldRun()) {
                rafId = requestAnimationFrame(loop);
            }
        }

        let lastMoveMs = 0;
        const onMouseMove = (e) => {
            if (!config.enablePointerWind || !shouldRun() || isMobile) return;
            const now = performance.now();
            if (now - lastMoveMs < 26) return;
            lastMoveMs = now;
            const dt = Math.max(1, now - (pointer.lastTime || now - 16));
            pointer.vx = Math.max(-14, Math.min(14, ((e.clientX - pointer.lastX) / dt) * 9));
            pointer.vy = Math.max(-14, Math.min(14, ((e.clientY - pointer.lastY) / dt) * 9));
            pointer.x = e.clientX;
            pointer.y = e.clientY;
            pointer.lastX = e.clientX;
            pointer.lastY = e.clientY;
            pointer.lastTime = now;
            pointer.active = true;
        };

        const onScroll = () => {
            if (!config.scrollThrottle || !shouldRun()) return;
            isUserScrolling = true;
            clearTimeout(scrollDebounceTimer);
            scrollDebounceTimer = setTimeout(() => {
                isUserScrolling = false;
            }, 140);
        };

        const onResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                sizeCanvas();
                if (shouldRun()) draw();
            }, 160);
        };

        const onVisibilityChange = () => reconcile();
        const onReducedMotionChange = () => reconcile();

        if (config.enablePointerWind) {
            window.addEventListener('mousemove', onMouseMove, { passive: true });
        }
        if (config.scrollThrottle) {
            window.addEventListener('scroll', onScroll, { passive: true });
        }
        window.addEventListener('resize', onResize, { passive: true });
        document.addEventListener('visibilitychange', onVisibilityChange);
        if (typeof reducedMotionQuery?.addEventListener === 'function') {
            reducedMotionQuery.addEventListener('change', onReducedMotionChange);
        } else if (typeof reducedMotionQuery?.addListener === 'function') {
            reducedMotionQuery.addListener(onReducedMotionChange);
        }

        sizeCanvas();
        reconcile();

        return Object.freeze({
            setRouteActive(active) {
                const next = Boolean(active);
                if (routeActive === next) return;
                routeActive = next;
                reconcile();
            },
            setSuspended(suspended, reason = 'default') {
                const key = String(reason || 'default');
                if (suspended) {
                    suspendReasons.add(key);
                } else {
                    suspendReasons.delete(key);
                }
                reconcile();
            },
            setAppearance(next = {}) {
                const nextTheme = next.theme === 'dark' ? 'dark' : 'light';
                const nextOnline = Boolean(next.bothOnline);
                if (appearance.theme === nextTheme && appearance.bothOnline === nextOnline) return;
                appearance = { theme: nextTheme, bothOnline: nextOnline };
                atlasEntry = getSharedAtlas(
                    config.alwaysDarkTone ? 'dark' : appearance.theme,
                    appearance.bothOnline
                );
                if (options.syncResonanceAttr) {
                    if (nextOnline) {
                        document.documentElement.setAttribute('data-resonance', 'online');
                    } else {
                        document.documentElement.removeAttribute('data-resonance');
                    }
                }
                if (shouldRun()) draw();
            },
            setAmbientMode(mode) {
                const normalized = (mode === 'dream' || mode === 'light' || mode === 'calm') ? mode : 'dream';
                ambientMode = normalized;
                if (normalized !== 'calm') {
                    autoDegradedOff = false;
                    degradeStrikes = 0;
                    qualityScale = isLowPowerDevice() ? 0.68 : 1.0;
                    syncPopulation();
                } else {
                    gustPetals.length = 0;
                }
                reconcile();
            },
            createBurst(x, y, count = 10) {
                spawnRippleAndPetals(x, y, count);
            },
            triggerMissYouFlutter() {
                triggerFlutter();
            },
            getMetrics() {
                return {
                    running: rafId !== null,
                    ambientMode,
                    particleCount: particles.length,
                    gustCount: gustPetals.length,
                    qualityScale,
                    autoDegradedOff,
                    suspendReasons: Array.from(suspendReasons)
                };
            },
            destroy() {
                stop();
                if (config.enablePointerWind) window.removeEventListener('mousemove', onMouseMove);
                if (config.scrollThrottle) window.removeEventListener('scroll', onScroll);
                window.removeEventListener('resize', onResize);
                document.removeEventListener('visibilitychange', onVisibilityChange);
                if (typeof reducedMotionQuery?.removeEventListener === 'function') {
                    reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
                } else if (typeof reducedMotionQuery?.removeListener === 'function') {
                    reducedMotionQuery.removeListener(onReducedMotionChange);
                }
            }
        });
    }

    window.createAtmosphericCanvasController = createAtmosphericCanvasController;

    // ── 1. 首页电影景深浮屏桃花雨 (#sakura-canvas) ──
    function isInitialHomeLocation() {
        const hash = window.location.hash;
        return !hash || hash === '#' || !hash.startsWith('#/') || hash === '#/' || hash.startsWith('#/?');
    }

    const homeCanvas = document.getElementById('sakura-canvas');
    const homeController = createAtmosphericCanvasController(homeCanvas, {
        desktopCount: 32,
        mobileCount: 18,
        lightDesktopCount: 10,
        lightMobileCount: 7,
        enablePointerWind: true,
        scrollThrottle: true,
        initialRouteActive: isInitialHomeLocation(),
        syncResonanceAttr: true,
        baseWind: 0.92
    });

    if (homeController) {
        window.homeSakuraEffect = homeController;
    }

    // ── 2. 个人主页浮屏景深桃花雨 (#profile-particles-canvas) ──
    let profileController = null;

    function ensureProfileController() {
        if (profileController) return profileController;
        const canvas = document.getElementById('profile-particles-canvas');
        if (!canvas) return null;
        profileController = createAtmosphericCanvasController(canvas, {
            desktopCount: 22,
            mobileCount: 13,
            lightDesktopCount: 8,
            lightMobileCount: 6,
            enablePointerWind: false,
            scrollThrottle: false,
            initialRouteActive: false,
            baseWind: 0.72
        });
        return profileController;
    }

    window.startProfileParticles = function startProfileParticles() {
        const ctrl = ensureProfileController();
        if (!ctrl) return;
        ctrl.setAmbientMode(getAmbientMode());
        ctrl.setAppearance({
            theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
            bothOnline: typeof bothOnline !== 'undefined' && Boolean(bothOnline)
        });
        ctrl.setRouteActive(true);
    };

    window.stopProfileParticles = function stopProfileParticles() {
        if (!profileController) return;
        profileController.setRouteActive(false);
    };

    // ── 3. 全站氛围档位与主题广播同步接口 ──
    const extraControllers = new Set();
    window.registerAmbientController = function registerAmbientController(ctrl) {
        if (ctrl) extraControllers.add(ctrl);
        return () => extraControllers.delete(ctrl);
    };

    window.syncAllAmbientEffects = function syncAllAmbientEffects({ mode, theme, bothOnline: online } = {}) {
        const targets = [homeController, profileController, ...extraControllers].filter(Boolean);
        targets.forEach(ctrl => {
            if (mode !== undefined) ctrl.setAmbientMode(mode);
            if (theme !== undefined || online !== undefined) {
                ctrl.setAppearance({
                    theme: theme !== undefined
                        ? theme
                        : (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
                    bothOnline: online !== undefined
                        ? Boolean(online)
                        : (typeof bothOnline !== 'undefined' && Boolean(bothOnline))
                });
            }
        });
    };

    // 切屏过渡期间统一冻结全站 Canvas 动画，避免与 GPU 合成争抢 60/120fps 帧预算
    window.suspendAllAmbientEffects = function suspendAllAmbientEffects(suspended, reason = 'route-transition') {
        const targets = [homeController, profileController, ...extraControllers].filter(Boolean);
        targets.forEach(ctrl => {
            if (typeof ctrl.setSuspended === 'function') {
                ctrl.setSuspended(Boolean(suspended), reason);
            }
        });
    };

    // 向后兼容：保留按需懒加载版 getEmojiSprite（零首屏预热开销）
    const lazyEmojiSpriteMap = {};
    window.getEmojiSprite = function getEmojiSprite(emoji, size = 28) {
        const key = `${emoji}_${size}`;
        if (lazyEmojiSpriteMap[key]) return lazyEmojiSpriteMap[key];
        const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        const canvas = document.createElement('canvas');
        const dim = Math.round((size + 8) * dpr);
        canvas.width = dim;
        canvas.height = dim;
        const c = canvas.getContext('2d');
        if (c) {
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(emoji, (size + 8) / 2, (size + 8) / 2);
        }
        lazyEmojiSpriteMap[key] = { canvas, size: size + 8 };
        return lazyEmojiSpriteMap[key];
    };
})();
