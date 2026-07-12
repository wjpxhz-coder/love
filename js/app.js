window.onload = async function() { 
    initTheme();
    createStarField();
    renderAnniversaries(); 
    initPresence();
    setTimeout(initCardGlow, 600);

    // 如果未登录，初始化展示锁定占位卡片
    if (!localStorage.getItem('lover_identity') && typeof showLockedUI === 'function') {
        showLockedUI();
    }

    await initAuth();
};
// ==========================================
// 注册 Service Worker (PWA)
// ==========================================
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('SW registered'))
        .catch(err => console.log('SW registration failed:', err));
}

let tempTargetVersionToSave = '';

function showVersionModal(versionName, useConfigLog = true) {
    const modal = document.getElementById('versionModal');
    if (!modal) return;

    tempTargetVersionToSave = versionName || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '');

    // 格式化版本号展示 (如 love-diary-v3.3.0 -> v3.3.0)
    let displayVersion = versionName || '';
    if (displayVersion.includes('love-diary-')) {
        displayVersion = displayVersion.replace('love-diary-', '');
    }

    const verNumEl = document.getElementById('versionNumber');
    const verDateEl = document.getElementById('versionDate');
    const verTitleEl = document.getElementById('versionTitle');
    const list = document.getElementById('versionChangelogList');

    if (verNumEl) verNumEl.textContent = displayVersion || (typeof UPDATE_LOG !== 'undefined' ? UPDATE_LOG.version : 'latest');
    
    list.innerHTML = '';

    if (useConfigLog && typeof UPDATE_LOG !== 'undefined') {
        if (verDateEl) verDateEl.textContent = `更新时间：${UPDATE_LOG.date}`;
        if (verTitleEl && UPDATE_LOG.title) verTitleEl.textContent = UPDATE_LOG.title;

        UPDATE_LOG.features.forEach(feat => {
            const li = document.createElement('li');
            li.textContent = feat;
            list.appendChild(li);
        });
    } else {
        // 自动降级：展示通用更新说明
        if (verDateEl) verDateEl.textContent = `检测到空间已更新 ✨`;
        if (verTitleEl) verTitleEl.textContent = '空间又升级啦 💖';

        const defaultFeats = [
            '空间已悄悄完成版本升级与体验优化 🛠️',
            '更新了部分缓存资源，日常访问更加流畅 🚀',
            '修复了一些小细节，快去体验一下吧！✨'
        ];
        defaultFeats.forEach(feat => {
            const li = document.createElement('li');
            li.textContent = feat;
            list.appendChild(li);
        });
    }

    modal.showModal();

    // 播放心形雨特效，增添浪漫感
    if (typeof createHeartRain === 'function') {
        setTimeout(createHeartRain, 300);
    }
}

function closeVersionModal() {
    const modal = document.getElementById('versionModal');
    if (modal) {
        modal.close();
    }
    // 保存已查看的版本号 (保存 SW 缓存名称作为唯一标识)
    if (tempTargetVersionToSave) {
        localStorage.setItem('last_seen_version', tempTargetVersionToSave);
    } else if (typeof APP_VERSION !== 'undefined') {
        localStorage.setItem('last_seen_version', APP_VERSION);
    }
}

