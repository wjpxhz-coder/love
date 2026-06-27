// ==========================================
// 纪念日
// ==========================================
function renderAnniversaries() {
    const grid = document.getElementById('anniv-grid');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    grid.innerHTML = ANNIVERSARIES.map(a => {
        let next = new Date(now.getFullYear(), a.month - 1, a.day);
        if (next < today) next.setFullYear(next.getFullYear() + 1);
        const diff = Math.round((next - today) / 86400000);
        const isToday = diff === 0;
        return `<div class="anniv-card ${isToday ? 'today' : ''}">
            <span class="anniv-icon">${a.icon}</span>
            <div class="anniv-name">${a.name}</div>
            <div class="anniv-days">${isToday ? '🎉今天！' : diff}</div>
            ${!isToday ? '<div class="anniv-unit">天后</div>' : ''}
        </div>`;
    }).join('');
}
