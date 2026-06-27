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
