window.onload = async function() { 
    initTheme();
    createStarField();
    fetchMoments(); 
    renderAnniversaries(); 
    loadMoods(); 
    initPresence();
    setTimeout(initCardGlow, 600);
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

// ==========================================
// 版本更新通知弹窗控制与渲染逻辑
// ==========================================
function showVersionModal() {
    const modal = document.getElementById('versionModal');
    if (!modal || typeof UPDATE_LOG === 'undefined') return;

    // 填充版本数据
    document.getElementById('versionNumber').textContent = UPDATE_LOG.version;
    document.getElementById('versionDate').textContent = `更新时间：${UPDATE_LOG.date}`;
    if (UPDATE_LOG.title) {
        document.getElementById('versionTitle').textContent = UPDATE_LOG.title;
    }

    const list = document.getElementById('versionChangelogList');
    list.innerHTML = '';
    UPDATE_LOG.features.forEach(feat => {
        const li = document.createElement('li');
        li.textContent = feat;
        list.appendChild(li);
    });

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
    // 保存已查看的版本号
    if (typeof APP_VERSION !== 'undefined') {
        localStorage.setItem('last_seen_version', APP_VERSION);
    }
}

