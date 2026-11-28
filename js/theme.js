
// ==========================================
// 7. 视觉升级模块
// ==========================================

// --- 深色模式 ---
function initTheme() {
    const saved = localStorage.getItem('theme_preference');
    const theme = saved === 'dark' ? 'dark' : 'light';
    applyTheme(theme);
    initAmbientMode();
    initCursorStyle();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#150d1e' : '#fff7f9';
    const isBothOnline = typeof bothOnline !== 'undefined' && Boolean(bothOnline);
    if (typeof window.syncAllAmbientEffects === 'function') {
        window.syncAllAmbientEffects({ theme, bothOnline: isBothOnline });
    } else {
        window.homeSakuraEffect?.setAppearance({ theme, bothOnline: isBothOnline });
    }
}

let activeThemeTransitionToken = 0;

function runSmoothThemeChange(nextTheme, afterApply) {
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (!prefersReduced && typeof document.startViewTransition === 'function' && !document.hidden) {
        const token = ++activeThemeTransitionToken;
        document.documentElement.classList.add('is-theme-transitioning');
        try {
            const vt = document.startViewTransition(() => {
                applyTheme(nextTheme);
                if (typeof afterApply === 'function') afterApply();
            });
            vt.finished
                .catch(() => {})
                .finally(() => {
                    if (token === activeThemeTransitionToken) {
                        document.documentElement.classList.remove('is-theme-transitioning');
                    }
                });
            return;
        } catch (_err) {
            if (token === activeThemeTransitionToken) {
                document.documentElement.classList.remove('is-theme-transitioning');
            }
        }
    }
    applyTheme(nextTheme);
    if (typeof afterApply === 'function') afterApply();
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme_preference', next);
    runSmoothThemeChange(next, () => {
        updateSettingsThemeButtons(next);
    });
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        const isDark = theme === 'dark';
        const iconId = isDark ? '#icon-sun' : '#icon-moon';
        btn.innerHTML = `<svg class="svg-icon theme-switch-anim" aria-hidden="true"><use href="${iconId}"/></svg>`;
        btn.setAttribute('aria-pressed', String(isDark));
        btn.setAttribute('aria-label', isDark ? '切换到浅色主题' : '切换到深色主题');
    }
}

function updateSettingsThemeButtons(theme) {
    const lightButton = document.getElementById('theme-btn-light');
    const darkButton = document.getElementById('theme-btn-dark');
    if (!lightButton || !darkButton) return;

    const isDark = theme === 'dark';
    lightButton.classList.toggle('active', !isDark);
    darkButton.classList.toggle('active', isDark);
    lightButton.setAttribute('aria-pressed', String(!isDark));
    darkButton.setAttribute('aria-pressed', String(isDark));
}

function setThemeDirect(theme) {
    if (typeof applyTheme !== 'function' || !['light', 'dark'].includes(theme)) return;
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    localStorage.setItem('theme_preference', theme);
    runSmoothThemeChange(theme, () => {
        updateSettingsThemeButtons(theme);
    });
    if (current !== theme && typeof showToast === 'function') {
        showToast(theme === 'dark' ? '已切换至星夜深色主题 🌙' : '已切换至晨曦浅色主题 ☀️');
    }
}

// --- 专属萌系鼠标样式（樱花奶蛇团 / 草莓奶芙猫爪 / 甜心樱花仙女棒 / 系统默认） ---
const CURSOR_STYLE_MODES = ['snake', 'paw', 'wand', 'system'];

function normalizeCursorStyle(raw) {
    if (raw === 'paw' || raw === 'wand' || raw === 'system') return raw;
    return 'snake';
}

function getStoredCursorStyle() {
    return normalizeCursorStyle(localStorage.getItem('cursor_preference'));
}

function initCursorStyle() {
    applyCursorStyle(getStoredCursorStyle());
}

function applyCursorStyle(mode) {
    const normalized = normalizeCursorStyle(mode);
    if (normalized === 'snake') {
        document.documentElement.removeAttribute('data-cursor');
    } else {
        document.documentElement.setAttribute('data-cursor', normalized);
    }
    updateSettingsCursorButtons(normalized);
}

function updateSettingsCursorButtons(mode) {
    const normalized = normalizeCursorStyle(mode);
    const buttonMap = {
        snake: document.getElementById('cursor-btn-snake'),
        paw: document.getElementById('cursor-btn-paw'),
        wand: document.getElementById('cursor-btn-wand'),
        system: document.getElementById('cursor-btn-system')
    };

    Object.entries(buttonMap).forEach(([key, btn]) => {
        if (!btn) return;
        const isActive = key === normalized;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

function setCursorDirect(mode) {
    if (mode === 'cute') mode = 'snake';
    if (!CURSOR_STYLE_MODES.includes(mode)) return;
    localStorage.setItem('cursor_preference', mode);
    applyCursorStyle(mode);
}

// --- 浮屏氛围动效档位（梦幻流光 dream / 轻盈呼吸 light / 静谧省电 calm） ---
const AMBIENT_MODES = ['dream', 'light', 'calm'];
const AMBIENT_MODE_LABELS = {
    dream: '🌸 梦幻流光',
    light: '🌬️ 轻盈呼吸',
    calm: '🍃 静谧省电'
};

function normalizeAmbientMode(raw) {
    if (raw === 'dream' || raw === 'light' || raw === 'calm') return raw;
    return navigator.connection?.saveData ? 'light' : 'dream';
}

function getStoredAmbientMode() {
    try {
        return normalizeAmbientMode(localStorage.getItem('ambient_preference'));
    } catch (_e) {
        return 'dream';
    }
}

function initAmbientMode() {
    applyAmbientMode(getStoredAmbientMode());
}

function applyAmbientMode(mode) {
    const normalized = normalizeAmbientMode(mode);
    document.documentElement.setAttribute('data-ambient', normalized);
    if (typeof window.syncAllAmbientEffects === 'function') {
        window.syncAllAmbientEffects({ mode: normalized });
    } else {
        window.homeSakuraEffect?.setAmbientMode?.(normalized);
    }
    updateSettingsAmbientButtons(normalized);
}

function updateSettingsAmbientButtons(mode) {
    const normalized = normalizeAmbientMode(mode);
    const buttonMap = {
        dream: document.getElementById('ambient-btn-dream'),
        light: document.getElementById('ambient-btn-light'),
        calm: document.getElementById('ambient-btn-calm')
    };

    Object.entries(buttonMap).forEach(([key, btn]) => {
        if (!btn) return;
        const isActive = key === normalized;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', String(isActive));
    });
}

function setAmbientDirect(mode) {
    if (!AMBIENT_MODES.includes(mode)) return;
    try {
        localStorage.setItem('ambient_preference', mode);
    } catch (_e) {}
    applyAmbientMode(mode);
    if (typeof showToast === 'function') {
        showToast(`氛围动效已切换为：${AMBIENT_MODE_LABELS[mode] || mode}`);
    }
}
