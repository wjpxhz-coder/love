
// ==========================================
// 7. 视觉升级模块
// ==========================================

// --- 深色模式 ---
function initTheme() {
    const saved = localStorage.getItem('theme_preference');
    const theme = saved || 'light';
    applyTheme(theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
    if (!bothOnline) {
        sakuraColor = theme === 'dark' ? '#c8a8d8' : '#f2b8c0';
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme_preference', next);
    applyTheme(next);
}

function updateThemeIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}
