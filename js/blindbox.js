// ==========================================
// 5. 回忆盲盒与摇一摇
// ==========================================
let isBlindBoxLoading = false;
let shakeLastTime = 0;
let lastX = 0, lastY = 0, lastZ = 0;

let deviceMotionRegistered = false;
async function triggerBlindBox(requestPermission = false) {
    if (requestPermission && !deviceMotionRegistered) {
        if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
            try {
                const permissionState = await DeviceMotionEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('devicemotion', handleShake, false);
                    deviceMotionRegistered = true;
                }
            } catch (e) {
                console.log('Request device motion failed', e);
            }
        } else {
            // Android / older iOS
            window.addEventListener('devicemotion', handleShake, false);
            deviceMotionRegistered = true;
        }
    }

    const modal = document.getElementById('blindBoxModal');
    modal.showModal();
    fetchRandomMoment();
}

function closeBlindBox() {
    document.getElementById('blindBoxModal').close();
}

function handleShake(event) {
    let now = Date.now();
    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;

    let x = acc.x || 0;
    let y = acc.y || 0;
    let z = acc.z || 0;
    
    if (lastX === 0 && lastY === 0 && lastZ === 0) {
        lastX = x; lastY = y; lastZ = z;
        return;
    }
    
    let delta = Math.abs(x - lastX) + Math.abs(y - lastY) + Math.abs(z - lastZ);
    lastX = x; lastY = y; lastZ = z;

    if (delta > 20) {
        if ((now - shakeLastTime) < 2500) return; // 2.5s 防抖
        shakeLastTime = now;
        
        const modal = document.getElementById('blindBoxModal');
        if (!modal.open) {
            modal.showModal();
        }
        fetchRandomMoment();
    }
}

async function fetchRandomMoment() {
    if (isBlindBoxLoading) return;
    isBlindBoxLoading = true;
    const contentBox = document.getElementById('blindBoxContent');
    contentBox.innerHTML = '<div style="color:var(--text-muted); font-size: 0.9em;">✨ 魔法生效中，正在抽取回忆...</div>';
    
    let rand = Math.random();
    let preferTypes = rand < 0.7 ? ['photo', 'moment'] : (rand < 0.9 ? ['text'] : ['audio']);
    
    let { data: ids, error } = await supabaseClient.from('moments').select('id, type');
    
    if (error || !ids || ids.length === 0) {
        contentBox.innerHTML = '<div style="color:var(--text-muted); font-size: 0.9em;">回忆库空空如也，快去多记录一些吧！</div>';
        isBlindBoxLoading = false;
        return;
    }

    let preferredIds = ids.filter(item => preferTypes.includes(item.type));
    if (preferredIds.length === 0) {
        preferredIds = ids;
    }

    const randomIndex = Math.floor(Math.random() * preferredIds.length);
    const randomId = preferredIds[randomIndex].id;

    const { data: momentData, error: mError } = await supabaseClient.from('moments').select('*').eq('id', randomId).single();

    if (mError || !momentData) {
        contentBox.innerHTML = '<div style="color:var(--text-muted); font-size: 0.9em;">拉取失败了，再试一次吧...</div>';
        isBlindBoxLoading = false;
        return;
    }

    const dateStr = new Date(momentData.created_at).toLocaleString('zh-CN', { hour12: false });
    let badge = momentData.author === '小蛇' ? '🐍 小蛇' : '🐟 小奚';
    
    let html = '';
    if (momentData.type === 'photo') {
        html += `<img class="blind-box-img" src="${momentData.content}" alt="回忆照片">`;
    } else if (momentData.type === 'audio') {
        html += `<div style="margin: 20px 0; width: 100%;"><audio controls src="${momentData.content}" style="width:100%; height: 40px; border-radius: 20px;"></audio></div>`;
    } else if (momentData.type === 'moment') {
        try {
            const data = JSON.parse(momentData.content);
            if (data.text) {
                html += `<div class="blind-box-text">${escapeHtml(data.text)}</div>`;
            }
            if (data.images && data.images.length > 0) {
                if (data.images.length === 1) {
                    const isVideo = data.images[0].match(/\.(mp4|mov|webm|ogg)$/i) || data.images[0].includes('video');
                    if (isVideo) {
                        html += `<video class="blind-box-img" src="${data.images[0]}" controls style="margin-top:10px; border-radius:12px; width:100%;"></video>`;
                    } else {
                        html += `<img class="blind-box-img" src="${data.images[0]}" alt="回忆照片" style="margin-top:10px;">`;
                    }
                } else {
                    html += `<div class="moment-grid" style="margin-top:10px;">`;
                    data.images.forEach(imgUrl => {
                        const isVideo = imgUrl.match(/\.(mp4|mov|webm|ogg)$/i) || imgUrl.includes('video');
                        if (isVideo) {
                            html += `<video class="moment-grid-item" src="${imgUrl}" autoplay muted loop playsinline style="object-fit:cover;"></video>`;
                        } else {
                            html += `<img class="moment-grid-item" src="${imgUrl}" alt="回忆照片">`;
                        }
                    });
                    html += `</div>`;
                }
            }
        } catch (e) {
            console.error("解析 moment 失败", e);
        }
    } else {
        html += `<div class="blind-box-text">${escapeHtml(momentData.content)}</div>`;
    }
    
    html += `<div class="blind-box-meta">${dateStr} · 来自 ${badge}</div>`;
    html += `<div class="blind-box-prompt">✨ 还记得这一天吗？</div>`;
    html += `<button class="btn-cancel" onclick="locateToMoment()" style="margin-top: 15px; font-size: 0.85em; padding: 6px 16px;">📍 定位到原文</button>`;
    
    window.currentBlindBoxMoment = momentData;
    contentBox.innerHTML = html;
    isBlindBoxLoading = false;
}

window.locateToMoment = function() {
    closeBlindBox();
    const contentDiv = document.getElementById('timeline-content');
    if (!contentDiv || !window.currentBlindBoxMoment) return;
    
    contentDiv.innerHTML = `
        <div style="text-align: center; margin-bottom: 20px;">
            <button onclick="fetchMoments()" style="padding: 8px 16px; font-size: 0.9em; background: rgba(200, 155, 155, 0.1); color: var(--primary); border: 1px dashed var(--primary-light); border-radius: 20px; box-shadow: none; display: inline-flex; cursor: pointer;">🔙 返回全部回忆</button>
        </div>
    `;
    
    const html = renderMomentCard(window.currentBlindBoxMoment);
    contentDiv.insertAdjacentHTML('beforeend', html);
    
    hasMore = false; // 移除加载指示器，防止下滑误触

    setTimeout(() => {
        if (typeof initScrollReveal === 'function') initScrollReveal();
        if (typeof loadCommentCounts === 'function') loadCommentCounts([window.currentBlindBoxMoment.id]);
        if (typeof loadMomentLikes === 'function') loadMomentLikes([window.currentBlindBoxMoment.id]);
        
        const card = document.getElementById('card-' + window.currentBlindBoxMoment.id);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 20px rgba(181, 115, 122, 0.6)';
            setTimeout(() => card.style.boxShadow = '', 2500);
        }
    }, 50);
}
