// ==========================================
// 纪念日
// ==========================================
function renderAnniversaries() {
    const grid = document.getElementById('anniv-grid');
    if (!grid) return;
    const now = new Date();
    const appDate = typeof getAppDateKey === 'function'
        ? getAppDateKey(now).split('-').map(Number)
        : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
    const [currentYear, currentMonth, currentDay] = appDate;
    const todayOrdinal = Date.UTC(currentYear, currentMonth - 1, currentDay);
    const fragment = document.createDocumentFragment();

    ANNIVERSARIES.forEach(anniversary => {
        let year = currentYear;
        let nextOrdinal = Date.UTC(year, anniversary.month - 1, anniversary.day);
        if (nextOrdinal < todayOrdinal) {
            year += 1;
            nextOrdinal = Date.UTC(year, anniversary.month - 1, anniversary.day);
        }
        const diff = Math.round((nextOrdinal - todayOrdinal) / 86400000);
        const isToday = diff === 0;

        const card = document.createElement('div');
        card.className = `anniv-card${isToday ? ' today' : ''}`;
        const icon = document.createElement('span');
        icon.className = 'anniv-icon';
        icon.textContent = anniversary.icon;
        icon.setAttribute('aria-hidden', 'true');
        const name = document.createElement('div');
        name.className = 'anniv-name';
        name.textContent = anniversary.name;
        const days = document.createElement('div');
        days.className = 'anniv-days';
        days.textContent = isToday ? '🎉今天！' : String(diff);
        card.append(icon, name, days);
        if (!isToday) {
            const unit = document.createElement('div');
            unit.className = 'anniv-unit';
            unit.textContent = '天后';
            card.appendChild(unit);
        }
        fragment.appendChild(card);
    });

    grid.replaceChildren(fragment);
}
