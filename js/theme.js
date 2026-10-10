
// ==========================================
// 7. 视觉升级模块
// ==========================================

// --- 深色模式 ---
function initTheme() {
    const saved = localStorage.getItem('theme_preference');
    const theme = saved === 'dark' ? 'dark' : 'light';
    applyTheme(theme);
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

