// ==========================================
// 3. 计时器
// ==========================================
function flipUpdate(id, newVal) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.textContent !== newVal) {
        el.textContent = newVal;
        el.classList.remove('flip');
        requestAnimationFrame(() => {
            el.classList.add('flip');
        });
    }
}

function updateTimer() {
    const now = new Date();
    const diff = Math.floor((now - startDate) / 1000);
    const days    = Math.floor(diff / 86400);
    const hours   = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    flipUpdate('t-days', String(days));
    flipUpdate('t-hours', String(hours).padStart(2,'0'));
    flipUpdate('t-minutes', String(minutes).padStart(2,'0'));
    flipUpdate('t-seconds', String(seconds).padStart(2,'0'));
}
let timerInterval = setInterval(updateTimer, 1000);
document.addEventListener('visibilitychange', () => {
if (document.hidden) {
    clearInterval(timerInterval);
} else {
    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}
});
updateTimer();
