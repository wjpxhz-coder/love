// --- 评论 ---
function checkPasswordForComment(momentId) {
    pendingCommentMomentId = momentId;
    if (currentAuthor) {
        showCommentInput(momentId);
        return;
    }
    currentAction = 'comment';
    const modal = document.getElementById('customModal');
    const input = document.getElementById('modalInput');
    const msgEl = document.getElementById('modalMsg');
    msgEl.innerText = '写评论需要验证暗号 💬';
    msgEl.style.color = '#b5737a';
    input.value = '';
    modal.showModal();
    setTimeout(() => input.focus(), 100);
}

function showCommentInput(momentId) {
    const writeBtn = document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = document.getElementById(`comment-input-area-${momentId}`);
    if (writeBtn) writeBtn.style.display = 'none';
    if (inputArea) {
        inputArea.style.display = 'block';
        
        const avatarContainer = document.getElementById(`comment-input-avatar-${momentId}`);
        if (avatarContainer) {
            const p = allProfilesCache[currentAuthor] || {};
            const emoji = currentAuthor === '小蛇' ? '🐍' : '🐟';
            const avatarHtml = p.avatar_url ? `<img src="${p.avatar_url}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" />` : emoji;
            const badgeClass = currentAuthor === '小蛇' ? 'author-snake' : 'author-xi';
            avatarContainer.innerHTML = `<span class="comment-author-badge author-badge ${badgeClass}">${avatarHtml} ${p.nickname || currentAuthor}</span>`;
        }

        const ta = document.getElementById(`comment-text-${momentId}`);
        if (ta) setTimeout(() => ta.focus(), 100);
    }
}

function cancelCommentInput(momentId) {
    const writeBtn = document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = document.getElementById(`comment-input-area-${momentId}`);
    const ta = document.getElementById(`comment-text-${momentId}`);
    if (ta) ta.value = '';
    if (inputArea) inputArea.style.display = 'none';
    if (writeBtn) writeBtn.style.display = 'inline-flex';
    // 清除图片选择
    commentImgFiles[momentId] = [];
    const previewEl = document.getElementById(`comment-img-previews-${momentId}`);
    if (previewEl) previewEl.innerHTML = '';
    const fileInput = document.getElementById(`comment-img-input-${momentId}`);
    if (fileInput) fileInput.value = '';
}

function toggleComments(momentId) {
    const section = document.getElementById(`comments-${momentId}`);
    if (!section) return;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    if (isHidden) loadComments(momentId);
}

async function loadComments(momentId) {
    const listEl = document.getElementById(`comment-list-${momentId}`);
    if (!listEl) return;
    listEl.innerHTML = '<div class="comment-empty">加载中…</div>';

    const { data, error } = await supabaseClient.from('comments')
        .select('*')
        .eq('moment_id', momentId)
        .order('created_at', { ascending: true });

    if (error) { listEl.innerHTML = `<div class="comment-empty">加载失败 😢</div>`; return; }

    if (!data || !data.length) {
        listEl.innerHTML = `<div class="comment-empty">还没有评论，来说点什么吧 ✨</div>`;
        return;
    }

    // 获取点赞数据（处理表不存在的情况）
    const commentIds = data.map(c => c.id);
    const { data: likesData, error: likesError } = await supabaseClient.from('comment_likes')
        .select('comment_id, author')
        .in('comment_id', commentIds);

    const likesMap = {};
    const userLikedMap = {};
    if (!likesError && likesData) {
        likesData.forEach(l => {
            likesMap[l.comment_id] = (likesMap[l.comment_id] || 0) + 1;
            if (l.author === currentAuthor) userLikedMap[l.comment_id] = true;
        });
    }

    listEl.innerHTML = data.map(c => {
        const dateStr = new Date(c.created_at).toLocaleString('zh-CN', { hour12: false });
        const badgeClass = c.author === '小蛇' ? 'author-snake' : 'author-xi';
        const emoji = c.author === '小蛇' ? '🐍' : '🐟';
        
        const p = allProfilesCache[c.author] || {};
        const avatarHtml = p.avatar_url 
            ? `<img src="${p.avatar_url}" style="width: 20px; height: 20px; border-radius: 50%; object-fit: cover; vertical-align: middle; margin-right: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2);" />` 
            : emoji;
        const displayName = p.nickname || c.author;
        
        const likeCount = likesMap[c.id] || 0;
        const isLiked = userLikedMap[c.id] || false;

        // 解析评论内容（支持图文）
        let bubbleContent = '';
        try {
            const parsed = JSON.parse(c.content);
            if (parsed.text) bubbleContent += escapeHtml(parsed.text);
            if (parsed.images && parsed.images.length > 0) {
                parsed.images.forEach(imgUrl => {
                    bubbleContent += `<img src="${imgUrl}" alt="评论图片" loading="lazy" onclick="openLightbox(this.src)">`;
                });
            }
        } catch(e) {
            bubbleContent = escapeHtml(c.content);
        }
        
        return `<div class="comment-item" id="comment-${c.id}">
            <span class="comment-author-badge author-badge ${badgeClass}" onclick="openProfilePage('${c.author}')" style="cursor:pointer;" title="点击查看主页">${avatarHtml} ${displayName}</span>
            <div style="flex:1;">
                <div class="comment-bubble">${bubbleContent}</div>
                <div class="comment-time">
                    ${dateStr} 
                    <button class="comment-like-btn${isLiked ? ' liked' : ''}" id="like-btn-${c.id}" onclick="toggleCommentLike(${c.id}, ${momentId})">
                        <span class="like-heart">${isLiked ? '❤️' : '🤍'}</span>
                        <span class="like-count" id="like-count-${c.id}">${likeCount > 0 ? likeCount : '赞'}</span>
                    </button>
                    <span style="color:#d4a0a8; cursor:pointer; margin-left:12px;" onclick="confirmDeleteComment(${c.id}, ${momentId})">撤回</span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function confirmDeleteComment(commentId, momentId) {
    pendingDeleteCommentId = commentId;
    pendingDeleteCommentMomentId = momentId;
    if (!confirm('确定要撤回这条评论吗？此操作不可逆哦 💬')) {
        return;
    }
    if (currentAuthor) {
        deleteComment(commentId, momentId);
        return;
    }
    currentAction = 'delete_comment';
    const modal = document.getElementById('customModal');
    const input = document.getElementById('modalInput');
    const msgEl = document.getElementById('modalMsg');
    msgEl.innerText = '撤回评论需要验证暗号 💬';
    msgEl.style.color = '#b5737a';
    input.value = '';
    modal.showModal();
    setTimeout(() => input.focus(), 100);
}

// --- 评论点赞 ---
async function toggleCommentLike(commentId, momentId) {
    if (!currentAuthor) {
        pendingCommentMomentId = momentId;
        checkPassword('comment');
        return;
    }

    const btn = document.getElementById(`like-btn-${commentId}`);
    const isLiked = btn && btn.classList.contains('liked');

    let error = null;
    if (isLiked) {
        // 取消点赞
        const res = await supabaseClient.from('comment_likes')
            .delete()
            .eq('comment_id', commentId)
            .eq('author', currentAuthor);
        error = res.error;
        if (!error) {
            await supabaseClient.from('notifications')
                .update({ type: 'recalled', content: '此点赞互动已被对方撤回' })
                .eq('type', 'like')
                .eq('related_id', commentId.toString())
                .eq('actor', currentAuthor);
        }
    } else {
        // 点赞
        const res = await supabaseClient.from('comment_likes')
            .insert([{ comment_id: commentId, author: currentAuthor }]);
        error = res.error;
    }

    if (error) {
        alert('点赞失败，请确保在 Supabase 创建了 comment_likes 表哦！\n错误信息：' + error.message);
        return;
    }

    // 刷新该评论的点赞状态
    updateSingleLike(commentId);
}

async function updateSingleLike(commentId) {
    const btn = document.getElementById(`like-btn-${commentId}`);
    if (!btn) return;

    const { data, error } = await supabaseClient.from('comment_likes')
        .select('author')
        .eq('comment_id', commentId);

    if (error) return;

    const count = data ? data.length : 0;
    const userLiked = data ? data.some(l => l.author === currentAuthor) : false;

    const heart = btn.querySelector('.like-heart');
    const countEl = btn.querySelector('.like-count');
    if (heart) heart.textContent = userLiked ? '❤️' : '🤍';
    if (countEl) countEl.textContent = count > 0 ? count : '赞';
    btn.classList.toggle('liked', userLiked);
}

async function deleteComment(commentId, momentId) {
    const { error } = await supabaseClient.from('comments').delete().eq('id', commentId);
    if (error) {
        alert('撤回失败: ' + error.message);
    } else {
        // 更新本评论的通知为已撤回状态
        await supabaseClient.from('notifications')
            .update({ type: 'recalled', content: '此评论互动已被对方撤回' })
            .eq('type', 'comment')
            .eq('related_id', commentId.toString());

        // 更新本评论的所有点赞通知为已撤回状态
        await supabaseClient.from('notifications')
            .update({ type: 'recalled', content: '此点赞互动已被对方撤回' })
            .eq('type', 'like')
            .eq('related_id', commentId.toString());

        const item = document.getElementById('comment-' + commentId);
        if (item) {
            item.style.transition = 'opacity 0.3s, transform 0.3s';
            item.style.opacity = '0';
            item.style.transform = 'translateX(-10px)';
            setTimeout(() => {
                loadComments(momentId);
                loadCommentCounts([momentId]);
            }, 300);
        }
    }
}

async function loadCommentCounts(momentIds) {
    if (!momentIds.length) return;
    const { data, error } = await supabaseClient.from('comments')
        .select('moment_id')
        .in('moment_id', momentIds);

    if (error) return;

    const counts = {};
    data.forEach(c => { counts[c.moment_id] = (counts[c.moment_id] || 0) + 1; });

    momentIds.forEach(id => {
        const countEl = document.getElementById(`comment-count-${id}`);
        if (countEl) {
            const count = counts[id] || 0;
            countEl.innerText = count > 0 ? `${count} 条评论` : '评论';
        }
    });
}

async function submitComment(momentId) {
    const ta = document.getElementById(`comment-text-${momentId}`);
    const textVal = ta ? ta.value.trim() : '';
    const imgs = commentImgFiles[momentId] || [];
    
    if (!textVal && imgs.length === 0) {
        if (ta) { ta.style.borderColor = 'var(--primary)'; ta.focus(); }
        return;
    }

    const submitBtn = document.querySelector(`#comment-input-area-${momentId} .comment-submit-btn`);
    const origText = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) { submitBtn.innerHTML = '发送中…'; submitBtn.disabled = true; }

    try {
        let uploadedImgUrls = [];
        if (imgs.length > 0) {
            const uploadPromises = imgs.map(async file => {
                const ext = file.name.split('.').pop();
                const fileName = `comments/${Date.now()}_${Math.random().toString(36).substring(2,8)}.${ext}`;
                const { error: upErr } = await supabaseClient.storage.from('photos').upload(fileName, file, { contentType: file.type, upsert: false });
                if (upErr) throw upErr;
                const { data } = supabaseClient.storage.from('photos').getPublicUrl(fileName);
                return data.publicUrl;
            });
            uploadedImgUrls = await Promise.all(uploadPromises);
        }

        // 如果有图片，将内容存为 JSON（兼容旧纯文本格式）
        let content;
        if (uploadedImgUrls.length > 0) {
            content = JSON.stringify({ text: textVal, images: uploadedImgUrls });
        } else {
            content = textVal;
        }

        const { error } = await supabaseClient.from('comments').insert([{
            moment_id: momentId,
            author: currentAuthor,
            content: content
        }]);

        if (error) throw error;

        cancelCommentInput(momentId);
        loadComments(momentId);
        loadCommentCounts([momentId]);
    } catch(err) {
        alert('评论发送失败: ' + err.message);
    } finally {
        if (submitBtn) { submitBtn.innerHTML = origText; submitBtn.disabled = false; }
    }
// ==========================================
// 评论图片选择
// ==========================================
let commentImgFiles = {}; // momentId -> File[]

window.handleCommentImgSelect = function(event, momentId) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    if (!commentImgFiles[momentId]) commentImgFiles[momentId] = [];
    const previewEl = document.getElementById(`comment-img-previews-${momentId}`);
    files.forEach(file => {
        commentImgFiles[momentId].push(file);
        const objUrl = URL.createObjectURL(file);
        const item = document.createElement('div');
        item.className = 'comment-img-preview-item';
        const idx = commentImgFiles[momentId].length - 1;
        item.innerHTML = `<img src="${objUrl}" alt="preview"><button class="rm-btn" onclick="removeCommentImg(${momentId}, ${idx}, this.parentElement)">×</button>`;
        previewEl.appendChild(item);
    });
    event.target.value = '';
};

window.removeCommentImg = function(momentId, idx, itemEl) {
    if (commentImgFiles[momentId]) {
        commentImgFiles[momentId].splice(idx, 1);
    }
    if (itemEl) itemEl.remove();
    // 重新编号所有预览元素的 data-idx
};
}
