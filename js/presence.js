// ==========================================
// presence.js — 同频共振（Supabase Realtime Presence）
// ==========================================

// --- 同频共振 (Presence) ---
let presenceChannel = null;

function initPresence() {
    presenceChannel = supabaseClient.channel('lovers_room');
    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            let snakeOnline = false;
            let xiOnline = false;
            for (const key in state) {
                state[key].forEach(presence => {
                    if (presence.user === '小蛇') snakeOnline = true;
                    if (presence.user === '小奚') xiOnline = true;
                });
            }
            
            bothOnline = snakeOnline && xiOnline;
            const ui = document.getElementById('resonance-ui');
            if (bothOnline) {
                ui.classList.add('show');
                sakuraColor = '#ffd700';
            } else {
                ui.classList.remove('show');
                const theme = document.documentElement.getAttribute('data-theme');
                sakuraColor = theme === 'dark' ? '#c8a8d8' : '#f2b8c0';
            }
        })
        .on('broadcast', { event: 'miss_you' }, (payload) => {
            const sender = payload.payload.sender;
            if (sender && sender !== currentAuthor) {
                createHeartRain();
                showToast(`💓 ${sender} 正在疯狂想你哦！`);
            }
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED' && currentAuthor) {
                updatePresence();
            }
        });
}

async function updatePresence() {
    if (!presenceChannel || !currentAuthor) return;
    await presenceChannel.track({
        user: currentAuthor,
        online_at: new Date().toISOString(),
    });
}
