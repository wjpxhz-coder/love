// --- 发布图文动态 ---
let momentSelectedFiles = [];
let momentAudioBlob = null;

function openMomentModal() {
    const modal = document.getElementById('momentModal');
    const input = document.getElementById('momentTextInput');
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    const titleEl = modal.querySelector('.modal-title');
    
    const p = allProfilesCache[currentAuthor] || {};
    const avatarHtml = p.avatar_url ? `<img src="${p.avatar_url}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.2);" />` : '';
    if (titleEl) titleEl.innerHTML = `${avatarHtml}✨ 发布动态`;

    document.getElementById('momentModalMsg').innerText = '';
    input.value = '';
    momentSelectedFiles = [];
    
    // 重置录音状态与预览
    momentAudioBlob = null;
    const btnAudio = document.getElementById('btn-moment-audio');
    const previewAudio = document.getElementById('momentAudioPreview');
    const playerAudio = document.getElementById('momentAudioPlayer');
    if (btnAudio) {
        btnAudio.style.display = 'flex';
        const txt = btnAudio.querySelector('.audio-text');
        if (txt) txt.innerText = '录制声音';
        const icon = btnAudio.querySelector('.audio-icon');
        if (icon) icon.innerText = '🎙️';
        btnAudio.classList.remove('recording-active');
        btnAudio.disabled = false;
    }
    if (previewAudio) previewAudio.style.display = 'none';
    if (playerAudio) playerAudio.src = '';
    
    // 保留添加按钮，移除已有的预览项
    const addBtn = previewContainer.querySelector('.moment-image-add-btn');
    previewContainer.innerHTML = '';
    if (addBtn) previewContainer.appendChild(addBtn);
    
    modal.showModal();
    setTimeout(() => input.focus(), 100);
}

function closeMomentModal() {
    document.getElementById('momentModal').close();
}

function handleMomentPhotoSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    const addBtn = previewContainer.querySelector('.moment-image-add-btn');
    files.forEach(file => {
        momentSelectedFiles.push(file);
        const objectUrl = URL.createObjectURL(file);
        const previewItem = document.createElement('div');
        previewItem.className = 'moment-preview-item';
        let mediaHtml = '';
        if (file.type.startsWith('video/')) {
            mediaHtml = `<video src="${objectUrl}" style="width:100%;height:100%;object-fit:cover;" autoplay muted loop playsinline></video>`;
        } else {
            mediaHtml = `<img src="${objectUrl}" alt="preview">`;
        }
        previewItem.innerHTML = `
            ${mediaHtml}
            <div class="remove-btn" onclick="removeMomentPhoto(this, '${file.name}')">×</div>
        `;
        previewContainer.insertBefore(previewItem, addBtn);
    });
    
    // 清空 input 使得重复选择相同文件能触发 change
    document.getElementById('momentPhotoInput').value = '';
}

window.removeMomentPhoto = function(btnElement, fileName) {
    const item = btnElement.parentElement;
    item.remove();
    momentSelectedFiles = momentSelectedFiles.filter(f => f.name !== fileName);
};

async function submitMomentPost() {
    const text = document.getElementById('momentTextInput').value.trim();
    const msgEl = document.getElementById('momentModalMsg');
    
    if (!text && momentSelectedFiles.length === 0 && !momentAudioBlob) {
        msgEl.innerText = '写点什么、发张照片或录段声音吧！';
        return;
    }

    const btn = document.getElementById('btn-submit-moment');
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ 发布中…'; 
    btn.disabled = true;

    try {
        let uploadedUrls = [];
        if (momentSelectedFiles.length > 0) {
            const uploadPromises = momentSelectedFiles.map(async file => {
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(2,9)}.${fileExt}`;
                const { error } = await supabaseClient.storage.from('photos').upload(fileName, file, { contentType: file.type, upsert: false });
                if (error) throw error;
                const { data } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
                return data.publicUrl;
            });
            uploadedUrls = await Promise.all(uploadPromises);
        }

        let audioUrl = null;
        if (momentAudioBlob) {
            const fileName = `audio_${Date.now()}_${Math.random().toString(36).substring(2,9)}.webm`;
            const { error: audioUploadError } = await supabaseClient.storage.from('photos').upload(fileName, momentAudioBlob, { contentType: 'audio/webm', upsert: false });
            if (audioUploadError) throw audioUploadError;
            const { data: audioData } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
            audioUrl = audioData.publicUrl;
        }

        const momentContent = JSON.stringify({
            text: text,
            images: uploadedUrls,
            audio: audioUrl
        });

        const { error: dbError } = await supabaseClient.from('moments')
            .insert([{ type: 'moment', content: momentContent, author: currentAuthor }]);
        
        if (dbError) throw dbError;
        
        closeMomentModal();
        fetchMoments();
    } catch (err) {
        msgEl.innerText = '发布失败: ' + err.message;
    } finally {
        btn.innerHTML = orig; 
        btn.disabled = false;
    }
}

// --- 录音功能（发布动态弹窗内部整合） ---
async function toggleMomentRecording() {
    if (isRecording) {
        // 停止录音
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        isRecording = false;
        return;
    }

    // 开始录音
    executeMomentRecording();
}

async function executeMomentRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = async () => {
            const duration = Date.now() - recordingStartTime;
            stream.getTracks().forEach(track => track.stop()); // 关闭麦克风
            
            const btn = document.getElementById('btn-moment-audio');
            if (duration < 1000) {
                alert('录音时间太短啦，至少要1秒哦！');
                resetMomentAudioBtn();
                return;
            }

            momentAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // 展示预览播放器，隐藏录制按钮
            const previewEl = document.getElementById('momentAudioPreview');
            const playerEl = document.getElementById('momentAudioPlayer');
            if (playerEl) {
                playerEl.src = URL.createObjectURL(momentAudioBlob);
            }
            if (previewEl) {
                previewEl.style.display = 'flex';
            }
            if (btn) {
                btn.style.display = 'none';
            }
            resetMomentAudioBtn();
        };

        mediaRecorder.start();
        isRecording = true;
        recordingStartTime = Date.now();
        
        const btn = document.getElementById('btn-moment-audio');
        if (btn) {
            const txt = btn.querySelector('.audio-text');
            if (txt) txt.innerText = '正在录音... 点击结束';
            const icon = btn.querySelector('.audio-icon');
            if (icon) icon.innerText = '🔴';
            btn.classList.add('recording-active');
        }
    } catch (err) {
        alert('无法访问麦克风，请检查设备权限设置！\n' + err.message);
        isRecording = false;
        resetMomentAudioBtn();
    }
}

function resetMomentAudioBtn() {
    const btn = document.getElementById('btn-moment-audio');
    if (btn) {
        const txt = btn.querySelector('.audio-text');
        if (txt) txt.innerText = '录制声音';
        const icon = btn.querySelector('.audio-icon');
        if (icon) icon.innerText = '🎙️';
        btn.classList.remove('recording-active');
    }
}

function deleteRecordedAudio() {
    momentAudioBlob = null;
    const previewEl = document.getElementById('momentAudioPreview');
    const playerEl = document.getElementById('momentAudioPlayer');
    const btn = document.getElementById('btn-moment-audio');
    
    if (playerEl) playerEl.src = '';
    if (previewEl) previewEl.style.display = 'none';
    if (btn) btn.style.display = 'flex';
}
// --- 时光轴（无限滚动） ---
let scrollObserver = null;

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatCardText(text, momentId) {
    if (!text) return '';
    if (text.length <= 80) {
        return `<div class="card-text">${escapeHtml(text)}</div>`;
    }
    const collapsedText = text.substring(0, 80) + '...';
    return `
        <div class="card-text-container" id="text-container-${momentId}">
            <div class="card-text text-collapsed" style="display: block;">${escapeHtml(collapsedText)}</div>
            <div class="card-text text-expanded" style="display: none;">${escapeHtml(text)}</div>
            <button class="toggle-text-btn" onclick="toggleTextCollapse(${momentId})">展开</button>
        </div>
    `;
}

function renderMomentCard(item) {
    const now = Date.now();
    const dateStr = new Date(item.created_at).toLocaleString('zh-CN', { hour12: false });
    const canDelete = (now - new Date(item.created_at).getTime()) < 86400000;
    const deleteBtn = canDelete
        ? `<button class="delete-btn" onclick="confirmDelete(${item.id})">撤回</button>`
        : '';

    const authorProfile = allProfilesCache[item.author] || {};
    const authorEmoji = item.author === '小蛇' ? '🐍' : (item.author === '小奚' ? '🐟' : '');
    const authorAvatarHtml = authorProfile.avatar_url 
        ? `<img src="${authorProfile.avatar_url}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" />` 
        : authorEmoji;
    const authorDisplayName = authorProfile.nickname || item.author;
    const authorBadgeClass = item.author === '小蛇' ? 'author-snake' : (item.author === '小奚' ? 'author-xi' : '');
    
    const authorBadge = item.author
        ? `<span class="author-badge ${authorBadgeClass}" onclick="openProfilePage('${item.author}')" style="cursor:pointer;" title="点击查看主页">${authorAvatarHtml} ${authorDisplayName}</span>`
        : '';

    let html = `<div class="moment-card" id="card-${item.id}">
            <div class="card-header">
                <div class="card-meta">
                    <span class="time-text">${dateStr}</span>
                    ${authorBadge}
                </div>
                ${deleteBtn}
            </div>`;

    if (item.type === 'text') {
        html += formatCardText(item.content, item.id);
    } else if (item.type === 'photo') {
        html += `<img class="card-img" src="${item.content}" alt="我们的回忆" loading="lazy" onclick="openLightbox(this.src)">`;
    } else if (item.type === 'audio') {
        html += `<div style="margin-top:10px;"><audio controls src="${item.content}" style="width:100%; height: 40px; border-radius: 20px; outline: none;"></audio></div>`;
    } else if (item.type === 'moment') {
        try {
            const data = JSON.parse(item.content);
            if (data.text) {
                html += formatCardText(data.text, item.id);
            }
            if (data.audio) {
                html += `<div style="margin-top:10px;"><audio controls src="${data.audio}" style="width:100%; height: 40px; border-radius: 20px; outline: none;"></audio></div>`;
            }
            if (data.images && data.images.length > 0) {
                if (data.images.length === 1) {
                    const isVideo = data.images[0].match(/\.(mp4|mov|webm|ogg)$/i) || data.images[0].includes('video');
                    if (isVideo) {
                        html += `<video class="moment-single-image" src="${data.images[0]}" controls style="width:100%; border-radius:12px; margin-top:10px;"></video>`;
                    } else {
                        html += `<img class="moment-single-image" src="${data.images[0]}" alt="我们的回忆" loading="lazy" onclick="openLightbox(this.src)">`;
                    }
                } else {
                    html += `<div class="moment-grid" id="moment-grid-${item.id}">`;
                    data.images.forEach((imgUrl, idx) => {
                        let displayStyle = idx >= 4 ? 'style="display:none;"' : '';
                        let extraClass = idx >= 4 ? 'hidden-image' : '';
                        const isVideo = imgUrl.match(/\.(mp4|mov|webm|ogg)$/i) || imgUrl.includes('video');
                        if (isVideo) {
                            html += `<video class="moment-grid-item ${extraClass}" src="${imgUrl}" ${displayStyle} autoplay muted loop playsinline onclick="openLightbox(this.src)" style="cursor:zoom-in; object-fit:cover;"></video>`;
                        } else {
                            html += `<img class="moment-grid-item ${extraClass}" src="${imgUrl}" alt="我们的回忆" loading="lazy" onclick="openLightbox(this.src)" ${displayStyle}>`;
                        }
                    });
                    html += `</div>`;
                    if (data.images.length > 4) {
                        let hiddenCount = data.images.length - 4;
                        html += `<button class="show-all-images-btn" id="show-images-btn-${item.id}" onclick="showAllImages(${item.id})">展开剩余 ${hiddenCount} 张照片 ↓</button>`;
                    }
                }
            }
        } catch (e) {
            console.error("解析 moment 失败", e);
        }
    }
    html += `
            <div class="moment-like-bar">
                <button class="moment-like-btn" id="moment-like-btn-${item.id}" onclick="toggleMomentLike(${item.id})">
                    <span class="ml-heart">🤍</span>
                    <span class="ml-count" id="moment-like-count-${item.id}">喜欢</span>
                </button>
                <span class="moment-like-likers" id="moment-like-likers-${item.id}"></span>
            </div>
            <button class="comment-toggle-btn" onclick="toggleComments(${item.id})">
                💬 <span id="comment-count-${item.id}">评论</span>
            </button>
            <div class="comment-section" id="comments-${item.id}" style="display:none;">
                <div class="comment-list" id="comment-list-${item.id}"></div>
                <button class="comment-write-btn" id="comment-write-btn-${item.id}" onclick="checkPasswordForComment(${item.id})">✏️ 写评论</button>
                <div class="comment-input-area" id="comment-input-area-${item.id}" style="display:none;">
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <div id="comment-input-avatar-${item.id}" style="display: flex; align-items: center;"></div>
                        <textarea class="comment-textarea" id="comment-text-${item.id}" placeholder="写下你的想法…" rows="2" style="margin-top: 0;"></textarea>
                        <div class="comment-img-previews" id="comment-img-previews-${item.id}"></div>
                    </div>
                    <div class="comment-submit-row" style="justify-content: space-between;">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <button class="comment-cancel-btn" onclick="cancelCommentInput(${item.id})">取消</button>
                            <button class="comment-img-upload-btn" onclick="document.getElementById('comment-img-input-${item.id}').click()">🖼️ 图片</button>
                            <input type="file" id="comment-img-input-${item.id}" accept="image/*" multiple style="display:none;" onchange="handleCommentImgSelect(event, ${item.id})">
                        </div>
                        <button class="comment-submit-btn" onclick="submitComment(${item.id})">发送 💌</button>
                    </div>
                </div>
            </div>
        </div>`;
    return html;
}

window.showAllImages = function(id) {
    const grid = document.getElementById(`moment-grid-${id}`);
    if (!grid) return;
    const hiddenImgs = grid.querySelectorAll('.hidden-image');
    hiddenImgs.forEach(img => {
        img.style.display = 'block';
    });
    const btn = document.getElementById(`show-images-btn-${id}`);
    if (btn) btn.style.display = 'none';
};

window.toggleTextCollapse = function(id) {
    const container = document.getElementById(`text-container-${id}`);
    if (!container) return;
    const collapsedEl = container.querySelector('.text-collapsed');
    const expandedEl = container.querySelector('.text-expanded');
    const btn = container.querySelector('.toggle-text-btn');
    
    if (collapsedEl.style.display === 'block') {
        collapsedEl.style.display = 'none';
        expandedEl.style.display = 'block';
        btn.innerText = '收起';
    } else {
        collapsedEl.style.display = 'block';
        expandedEl.style.display = 'none';
        btn.innerText = '展开';
    }
};

// --- 高级检索/筛选 ---
let currentFilters = {
    year: '',
    month: '',
    authors: [],
    types: [],
    keyword: ''
};

function openFilterModal() {
    document.getElementById('filterModal').showModal();
}

function closeFilterModal() {
    document.getElementById('filterModal').close();
}

function clearFilters() {
    document.getElementById('filterYear').value = '';
    document.getElementById('filterMonth').value = '';
    document.getElementById('chkAuthorSnake').checked = false;
    document.getElementById('chkAuthorXi').checked = false;
    document.getElementById('chkTypeMoment').checked = false;
    document.getElementById('chkTypeText').checked = false;
    document.getElementById('chkTypePhoto').checked = false;
    document.getElementById('chkTypeAudio').checked = false;
    document.getElementById('filterKeyword').value = '';
}

function applyFilters() {
    currentFilters.year = document.getElementById('filterYear').value;
    currentFilters.month = document.getElementById('filterMonth').value;
    currentFilters.authors = [];
    if (document.getElementById('chkAuthorSnake').checked) currentFilters.authors.push('小蛇');
    if (document.getElementById('chkAuthorXi').checked) currentFilters.authors.push('小奚');
    
    currentFilters.types = [];
    if (document.getElementById('chkTypeMoment').checked) currentFilters.types.push('moment');
    if (document.getElementById('chkTypeText').checked) currentFilters.types.push('text');
    if (document.getElementById('chkTypePhoto').checked) currentFilters.types.push('photo');
    if (document.getElementById('chkTypeAudio').checked) currentFilters.types.push('audio');
    
    currentFilters.keyword = document.getElementById('filterKeyword').value.trim();

    closeFilterModal();
    updateFilterIndicator();
    fetchMoments(false); // 重置并根据新条件拉取
}

function updateFilterIndicator() {
    const indicator = document.getElementById('filter-indicator');
    const fab = document.getElementById('fab-filter');
    let active = false;
    let text = '已开启筛选: ';
    let details = [];

    if (currentFilters.year || currentFilters.month) {
        active = true;
        details.push(`${currentFilters.year || '所有'}年${currentFilters.month ? currentFilters.month + '月' : ''}`);
    }
    if (currentFilters.authors.length > 0) {
        active = true;
        details.push(currentFilters.authors.join('或'));
    }
    if (currentFilters.types.length > 0) {
        active = true;
        let typeNames = currentFilters.types.map(t => {
            if (t === 'moment') return '图文';
            if (t === 'text') return '文字';
            if (t === 'photo') return '照片';
            if (t === 'audio') return '声音';
        });
        details.push(typeNames.join('或'));
    }
    if (currentFilters.keyword) {
        active = true;
        details.push(`包含"${currentFilters.keyword}"`);
    }

    if (active) {
        indicator.innerText = text + details.join(' | ') + ' (点击修改或重置)';
        indicator.classList.add('show');
        fab.classList.add('active');
    } else {
        indicator.classList.remove('show');
        fab.classList.remove('active');
    }
}

async function fetchMoments(append = false) {
    if (isLoading) return;
    if (append && !hasMore) return;

    isLoading = true;
    const contentDiv = document.getElementById('timeline-content');

    if (!append) {
        currentPage = 0;
        hasMore = true;
        contentDiv.innerHTML = '<div class="empty-state">正在加载甜蜜回忆…</div>';
    }

    const from = currentPage * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabaseClient.from('moments')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to);

    // 应用筛选条件
    if (currentFilters.authors.length > 0) {
        query = query.in('author', currentFilters.authors);
    }
    if (currentFilters.types.length > 0) {
        if (currentFilters.types.includes('audio')) {
            if (currentFilters.types.length === 1) {
                // 如果只筛选声音类型，查找旧的 audio 类型，以及带有 audio 属性的 moment 类型
                query = query.or('type.eq.audio,and(type.eq.moment,content.ilike.%\"audio\"%)');
            } else {
                // 如果筛选了多种类型（包括声音），则查找相应的类型集合
                // 因为 types 里面包含了 'moment' 等其他类型，已经能够拉取出 moment 类型的记录
                query = query.in('type', currentFilters.types);
            }
        } else {
            query = query.in('type', currentFilters.types);
        }
    }
    if (currentFilters.keyword) {
        query = query.ilike('content', `%${currentFilters.keyword}%`);
    }
    if (currentFilters.year) {
        let startYear = parseInt(currentFilters.year);
        // JavaScript 月份是 0-11
        let startMonth = currentFilters.month ? parseInt(currentFilters.month) - 1 : 0;
        let endYear = startMonth === 11 ? startYear + 1 : startYear;
        let endMonth = startMonth === 11 ? 0 : startMonth + 1;
        
        if (!currentFilters.month) {
            endYear = startYear + 1;
            endMonth = 0;
        }

        // ISO string, assuming server time is UTC or similar, this local date bound is generally fine
        let startDateStr = new Date(startYear, startMonth, 1).toISOString();
        let endDateStr = new Date(endYear, endMonth, 1).toISOString();
        query = query.gte('created_at', startDateStr).lt('created_at', endDateStr);
    }

    const { data, error } = await query;

    isLoading = false;

    if (error) {
        if (!append) contentDiv.innerHTML = `<p style="color:#b5737a;text-align:center;">读取数据失败: ${error.message}</p>`;
        return;
    }

    if (data.length < PAGE_SIZE) hasMore = false;

    if (!append && data.length === 0) {
        contentDiv.innerHTML = '<div class="empty-state">还没有记录哦，快去添加第一条回忆吧！</div>';
        return;
    }

    if (!append) contentDiv.innerHTML = '';

    // 移除已有的加载指示器
    const existingLoader = contentDiv.querySelector('.load-more-indicator');
    if (existingLoader) existingLoader.remove();

    // 渲染新卡片
    const html = data.map(item => renderMomentCard(item)).join('');
    contentDiv.insertAdjacentHTML('beforeend', html);

    // 触发滚动入场
    setTimeout(() => initScrollReveal(), 50);

    // 添加加载更多提示
    if (hasMore) {
        contentDiv.insertAdjacentHTML('beforeend',
            '<div class="load-more-indicator"><span class="load-more-spinner"></span>下滑加载更多回忆…</div>');
    }

    currentPage++;

    // 批量加载评论计数
    loadCommentCounts(data.map(item => item.id));

    // 批量加载动态点赞
    loadMomentLikes(data.map(item => item.id));

    // 设置滚动观察器
    setupScrollObserver();
}

function setupScrollObserver() {
    if (scrollObserver) scrollObserver.disconnect();
    const loader = document.querySelector('.load-more-indicator');
    if (!loader || !hasMore) return;
    scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMore) {
            fetchMoments(true);
        }
    }, { rootMargin: '200px' });
    scrollObserver.observe(loader);
}

// --- 删除 ---
function confirmDelete(id) {
    pendingDeleteId = id;
    if (!confirm('确定要撤回这条回忆吗？此操作不可逆哦 💖')) {
        return;
    }
    if (currentAuthor) {
        deleteMoment(id);
        return;
    }
    currentAction = 'delete';
    const modal = document.getElementById('customModal');
    const input = document.getElementById('modalInput');
    const msgEl = document.getElementById('modalMsg');
    msgEl.innerText = '撤回需要验证暗号 💖';
    msgEl.style.color = '#b5737a';
    input.value = '';
    modal.showModal();
    setTimeout(() => input.focus(), 100);
}

async function deleteMoment(id) {
    // 先查询该动态下的所有评论 ID
    const { data: comments } = await supabaseClient.from('comments').select('id').eq('moment_id', id);

    const { error } = await supabaseClient.from('moments').delete().eq('id', id);
    if (error) {
        alert('撤回失败: ' + error.message);
    } else {
        // 更新本动态的通知为已撤回状态
        await supabaseClient.from('notifications')
            .update({ type: 'recalled', content: '此动态互动已被对方撤回' })
            .eq('type', 'moment')
            .eq('related_id', id.toString());

        // 更新本动态下所有评论的通知为已撤回状态
        if (comments && comments.length > 0) {
            const commentIds = comments.map(c => c.id.toString());
            await supabaseClient.from('notifications')
                .update({ type: 'recalled', content: '此评论互动已被对方撤回' })
                .eq('type', 'comment')
                .in('related_id', commentIds);

            // 同时更新该动态下评论的点赞通知为已撤回状态
            await supabaseClient.from('notifications')
                .update({ type: 'recalled', content: '此点赞互动已被对方撤回' })
                .eq('type', 'like')
                .in('related_id', commentIds);
        }

        const card = document.getElementById('card-' + id);
        if (card) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-16px)';
            setTimeout(() => fetchMoments(), 300);
        }
    }
}
