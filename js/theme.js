
// ==========================================
// 7. 视觉升级模块
// ==========================================

// --- 深色模式 ---
function initTheme() {
    const saved = localStorage.getItem('theme_preference');
    const theme = saved === 'dark' ? 'dark' : 'light';
    applyTheme(theme);
    initCursorStyle();
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#150d1e' : '#fff7f9';
    window.homeSakuraEffect?.setAppearance({
        theme,
        bothOnline: typeof bothOnline !== 'undefined' && bothOnline
    });
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme_preference', next);
    applyTheme(next);
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        const isDark = theme === 'dark';
        const iconId = isDark ? '#icon-sun' : '#icon-moon';
        btn.innerHTML = `<svg class="svg-icon" aria-hidden="true"><use href="${iconId}"/></svg>`;
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
    localStorage.setItem('theme_preference', theme);
    applyTheme(theme);
    updateSettingsThemeButtons(theme);
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
