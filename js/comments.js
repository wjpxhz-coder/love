// --- 评论 ---
let commentImgFiles = {}; // momentId -> { id, file, objectUrl }[]
let nextCommentImageId = 1;
const commentLoadRequests = new Map();
const commentSubmitRequests = new Set();
const MAX_COMMENT_TEXT_LENGTH = 1000;
const MAX_COMMENT_IMAGE_COUNT = 4;
const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_COMMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function hasCommentAuthContext() {
    return typeof hasAuthContext === 'function' ? hasAuthContext() : Boolean(currentAuthUser && currentAuthor);
}

function getCommentAuthEpoch() {
    return typeof getAuthEpoch === 'function' ? getAuthEpoch() : (typeof authEpoch === 'number' ? authEpoch : 0);
}

function isCommentAuthEpochCurrent(epoch) {
    return typeof isCurrentAuthSnapshot === 'function' && currentAuthUser
        ? isCurrentAuthSnapshot(epoch, currentAuthUser.id)
        : (hasCommentAuthContext() && getCommentAuthEpoch() === epoch);
}


function getCommentTrustedMediaUrl(value) {
    return typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(value) : '';
}

function getCommentProfileAvatarUrl(profile) {
    if (typeof getProfileAvatarUrl === 'function') return getProfileAvatarUrl(profile);
    return getCommentTrustedMediaUrl(profile && profile.avatar_url);
}

function getCommentStorageDirectory() {
    const spaceId = currentUserProfile && String(currentUserProfile.space_id || '');
    const userId = currentAuthUser && String(currentAuthUser.id || '');
    const isSafeSegment = value => /^[A-Za-z0-9_-]+$/.test(value);
    if (!isSafeSegment(spaceId) || !isSafeSegment(userId)) return '';
    return `${spaceId}/${userId}/comments`;
}

function getCommentFileExtension(file) {
    const nameExtension = String(file && file.name || '').split('.').pop().toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(nameExtension)) return nameExtension;
    const typeExtension = String(file && file.type || '').split('/').pop().split(';')[0].toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(typeExtension) ? typeExtension : 'bin';
}

async function removeUploadedCommentObjects(paths) {
    if (!paths.length) return;
    const { error } = await supabaseClient.storage.from('photos').remove(paths);
    if (error) console.error('清理未完成的评论图片失败:', error);
}

async function resolveCommentContent(rawContent) {
    let text = '';
    let imageValues = [];
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            text = typeof parsed.text === 'string' ? parsed.text : '';
            imageValues = Array.isArray(parsed.images) ? parsed.images : [];
        } else {
            text = String(rawContent || '');
        }
    } catch (_error) {
        text = String(rawContent || '');
    }

    const images = (await Promise.all(imageValues.map(async value => {
        try {
            const resolved = typeof resolveMediaUrl === 'function' ? await resolveMediaUrl(value) : value;
            return getCommentTrustedMediaUrl(resolved);
        } catch (_error) {
            return '';
        }
    }))).filter(Boolean);
    return { text, images };
}

function setCommentStatus(container, text) {
    const status = document.createElement('div');
    status.className = 'comment-empty';
    status.textContent = text;
    container.replaceChildren(status);
}

function clearCommentImageSelection(momentId) {
    (commentImgFiles[momentId] || []).forEach(entry => URL.revokeObjectURL(entry.objectUrl));
    delete commentImgFiles[momentId];
    const previewEl = document.getElementById(`comment-img-previews-${momentId}`);
    if (previewEl) previewEl.replaceChildren();
}

function clearAllCommentImageSelections() {
    Object.keys(commentImgFiles).forEach(momentId => clearCommentImageSelection(momentId));
}

function checkPasswordForComment(momentId) {
    pendingCommentMomentId = momentId;
    if (hasCommentAuthContext()) {
        showCommentInput(momentId);
        return;
    }
    if (typeof openLoginModal === 'function') openLoginModal();
}

function showCommentInput(momentId) {
    if (!hasCommentAuthContext()) return;
    const writeBtn = document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = document.getElementById(`comment-input-area-${momentId}`);
    if (writeBtn) writeBtn.style.display = 'none';
    if (inputArea) {
        inputArea.style.display = 'block';
        
        const avatarContainer = document.getElementById(`comment-input-avatar-${momentId}`);
        if (avatarContainer) {
            const p = allProfilesCache[currentAuthor] || {};
            const emoji = currentAuthor === '小蛇' ? '🐍' : '🐟';
            const badgeClass = currentAuthor === '小蛇' ? 'author-snake' : 'author-xi';
            const badge = document.createElement('span');
            badge.className = `comment-author-badge author-badge ${badgeClass}`;
            const avatarUrl = getCommentProfileAvatarUrl(p);
            if (avatarUrl) {
                const avatar = document.createElement('img');
                avatar.src = avatarUrl;
                avatar.alt = '';
                Object.assign(avatar.style, {
                    width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover',
                    verticalAlign: 'middle', marginRight: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                });
                badge.appendChild(avatar);
            } else {
                badge.appendChild(document.createTextNode(`${emoji} `));
            }
            badge.appendChild(document.createTextNode(String(p.nickname || currentAuthor)));
            avatarContainer.replaceChildren(badge);
        }

        const ta = document.getElementById(`comment-text-${momentId}`);
        if (ta) setTimeout(() => ta.focus(), 100);
    }
}

function cancelCommentInput(momentId) {
    if (commentSubmitRequests.has(momentId)) {
        if (typeof showToast === 'function') showToast('评论正在发送，请稍候…');
        return;
    }
    const writeBtn = document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = document.getElementById(`comment-input-area-${momentId}`);
    const ta = document.getElementById(`comment-text-${momentId}`);
    if (ta) ta.value = '';
    if (inputArea) inputArea.style.display = 'none';
    if (writeBtn) writeBtn.style.display = 'inline-flex';
    // 清除图片选择
    clearCommentImageSelection(momentId);
    const fileInput = document.getElementById(`comment-img-input-${momentId}`);
    if (fileInput) fileInput.value = '';
}

function toggleComments(momentId) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const section = document.getElementById(`comments-${momentId}`);
    if (!section) return;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    section.setAttribute('aria-hidden', String(!isHidden));
    document.getElementById(`comment-toggle-${momentId}`)?.setAttribute('aria-expanded', String(isHidden));
    if (isHidden) loadComments(momentId);
}

async function loadComments(momentId) {
    if (!hasCommentAuthContext()) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const requestId = (commentLoadRequests.get(momentId) || 0) + 1;
    commentLoadRequests.set(momentId, requestId);
    const listEl = document.getElementById(`comment-list-${momentId}`);
    if (!listEl) return;
    setCommentStatus(listEl, '加载中…');

    const { data, error } = await supabaseClient.from('comments')
        .select('id, moment_id, user_id, author, content, created_at')
        .eq('moment_id', momentId)
        .order('created_at', { ascending: true });

    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;
    if (error) { setCommentStatus(listEl, '加载失败 😢'); return; }

    if (!data || !data.length) {
        setCommentStatus(listEl, '还没有评论，来说点什么吧 ✨');
        return;
    }

    // 获取点赞数据（处理表不存在的情况）
    const commentIds = data.map(c => c.id);
    const { data: likesData, error: likesError } = await supabaseClient.from('comment_likes')
        .select('comment_id, user_id')
        .in('comment_id', commentIds);
    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;

    const likesMap = {};
    const userLikedMap = {};
    if (!likesError && likesData) {
        likesData.forEach(l => {
            likesMap[l.comment_id] = (likesMap[l.comment_id] || 0) + 1;
            if (currentAuthUser && l.user_id === currentAuthUser.id) userLikedMap[l.comment_id] = true;
        });
    }

    const resolvedContents = await Promise.all(data.map(comment => resolveCommentContent(comment.content)));
    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;

    const fragment = document.createDocumentFragment();
    data.forEach((c, commentIndex) => {
        const commentId = Number(c.id);
        if (!Number.isSafeInteger(commentId) || commentId <= 0) return;
        const dateStr = new Date(c.created_at).toLocaleString('zh-CN', { hour12: false });
        const badgeClass = c.author === '小蛇' ? 'author-snake' : 'author-xi';
        const emoji = c.author === '小蛇' ? '🐍' : '🐟';
        
        const p = allProfilesCache[c.author] || {};
        const displayName = p.nickname || c.author;
        
        const likeCount = likesMap[c.id] || 0;
        const isLiked = userLikedMap[c.id] || false;

        const textContent = resolvedContents[commentIndex].text;
        const imageUrls = resolvedContents[commentIndex].images;

        const item = document.createElement('div');
        item.className = 'comment-item';
        item.id = `comment-${commentId}`;
        const authorBadge = document.createElement('span');
        authorBadge.className = `comment-author-badge author-badge ${badgeClass}`;
        authorBadge.style.cursor = 'pointer';
        authorBadge.title = '点击查看主页';
        authorBadge.tabIndex = 0;
        authorBadge.setAttribute('role', 'button');
        const avatarUrl = getCommentProfileAvatarUrl(p);
        if (avatarUrl) {
            const avatar = document.createElement('img');
            avatar.src = avatarUrl;
            avatar.alt = '';
            Object.assign(avatar.style, {
                width: '20px', height: '20px', borderRadius: '50%', objectFit: 'cover',
                verticalAlign: 'middle', marginRight: '4px', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
            });
            authorBadge.appendChild(avatar);
        } else {
            authorBadge.appendChild(document.createTextNode(`${emoji} `));
        }
        authorBadge.appendChild(document.createTextNode(String(displayName || '')));
        const openProfile = () => {
            if (typeof openProfilePage === 'function') openProfilePage(String(c.author || ''));
        };
        authorBadge.addEventListener('click', openProfile);
        authorBadge.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProfile();
            }
        });

        const body = document.createElement('div');
        body.style.flex = '1';
        const bubble = document.createElement('div');
        bubble.className = 'comment-bubble';
        if (textContent) bubble.appendChild(document.createTextNode(textContent));
        imageUrls.forEach(url => {
            const image = document.createElement('img');
            image.src = url;
            image.alt = '评论图片';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.classList.add('media-loading');
            const onImgLoad = () => {
                image.classList.remove('media-loading');
                image.classList.add('media-loaded');
            };
            if (image.complete) onImgLoad();
            else {
                image.addEventListener('load', onImgLoad, { once: true });
                image.addEventListener('error', onImgLoad, { once: true });
            }
            image.addEventListener('click', () => {
                if (typeof openLightbox === 'function') openLightbox(url);
            });
            bubble.appendChild(image);
        });

        const time = document.createElement('div');
        time.className = 'comment-time';
        time.appendChild(document.createTextNode(`${dateStr} `));
        const likeButton = document.createElement('button');
        likeButton.type = 'button';
        likeButton.className = `comment-like-btn${isLiked ? ' liked' : ''}`;
        likeButton.id = `like-btn-${commentId}`;
        const heart = document.createElement('span');
        heart.className = 'like-heart';
        heart.textContent = isLiked ? '❤️' : '🤍';
        const count = document.createElement('span');
        count.className = 'like-count';
        count.id = `like-count-${commentId}`;
        count.textContent = likeCount > 0 ? String(likeCount) : '赞';
        likeButton.append(heart, count);
        likeButton.addEventListener('click', () => toggleCommentLike(commentId, momentId));
        time.appendChild(likeButton);
        if (currentAuthUser && c.user_id === currentAuthUser.id) {
            const recall = document.createElement('button');
            recall.type = 'button';
            recall.textContent = '撤回';
            Object.assign(recall.style, {
                color: 'var(--primary)', cursor: 'pointer', marginLeft: '12px',
                border: '0', background: 'transparent', padding: '0'
            });
            recall.addEventListener('click', () => confirmDeleteComment(commentId, momentId));
            time.appendChild(recall);
        }
        body.append(bubble, time);
        item.append(authorBadge, body);
        fragment.appendChild(item);
    });
    listEl.replaceChildren(fragment);
}

function confirmDeleteComment(commentId, momentId) {
    pendingDeleteCommentId = commentId;
    pendingDeleteCommentMomentId = momentId;
    if (!confirm('确定要撤回这条评论吗？此操作不可逆哦 💬')) {
        return;
    }
    if (hasCommentAuthContext()) {
        deleteComment(commentId, momentId);
        return;
    }
    if (typeof openLoginModal === 'function') openLoginModal();
}

// --- 评论点赞 ---
async function toggleCommentLike(commentId, momentId) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const requestAuthEpoch = getCommentAuthEpoch();

    const btn = document.getElementById(`like-btn-${commentId}`);
    const isLiked = btn && btn.classList.contains('liked');

    let error = null;
    if (isLiked) {
        // 取消点赞
        if (!currentAuthUser || !currentAuthUser.id) return;
        const res = await supabaseClient.from('comment_likes')
            .delete()
            .eq('comment_id', commentId)
            .eq('user_id', currentAuthUser.id);
        error = res.error;
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
        if (!error && currentAuthUser) {
            await supabaseClient.from('notifications')
                .update({ type: 'recalled', content: '此点赞互动已被对方撤回' })
                .eq('type', 'like')
                .eq('related_id', commentId.toString())
                .eq('actor_id', currentAuthUser.id);
            if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
        }
    } else {
        // 点赞
        const res = await supabaseClient.from('comment_likes')
            .insert([{ comment_id: commentId }]);
        error = res.error;
    }
    if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;

    if (error) {
        console.error('评论点赞失败:', error);
        alert('点赞失败，请稍后重试。');
        return;
    }

    // 刷新该评论的点赞状态
    updateSingleLike(commentId);
}

async function updateSingleLike(commentId) {
    if (!hasCommentAuthContext()) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const btn = document.getElementById(`like-btn-${commentId}`);
    if (!btn) return;

    const { data, error } = await supabaseClient.from('comment_likes')
        .select('user_id')
        .eq('comment_id', commentId);

    if (error || !isCommentAuthEpochCurrent(requestAuthEpoch)) return;

    const count = data ? data.length : 0;
    const userLiked = (data && currentAuthUser) ? data.some(l => l.user_id === currentAuthUser.id) : false;

    const heart = btn.querySelector('.like-heart');
    const countEl = btn.querySelector('.like-count');
    if (heart) heart.textContent = userLiked ? '❤️' : '🤍';
    if (countEl) countEl.textContent = count > 0 ? count : '赞';
    btn.classList.toggle('liked', userLiked);
}

async function deleteComment(commentId, momentId) {
    if (!hasCommentAuthContext()) return;
    const normalizedCommentId = Number(commentId);
    if (!Number.isSafeInteger(normalizedCommentId) || normalizedCommentId <= 0) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const { data: deleted, error } = await supabaseClient.rpc('recall_and_delete_comment', {
        p_comment_id: normalizedCommentId
    });
    if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
    if (error || deleted !== true) {
        console.error('撤回评论失败:', error);
        alert('撤回失败，请稍后重试。');
    } else {
        const item = document.getElementById('comment-' + normalizedCommentId);
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
    if (!hasCommentAuthContext() || !momentIds.length) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const { data, error } = await supabaseClient.from('comments')
        .select('moment_id')
        .in('moment_id', momentIds);

    if (error || !isCommentAuthEpochCurrent(requestAuthEpoch)) return;

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
    if (!hasCommentAuthContext() || commentSubmitRequests.has(momentId)) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const ta = document.getElementById(`comment-text-${momentId}`);
    const textVal = ta ? ta.value.trim() : '';
    const imageEntries = commentImgFiles[momentId] || [];
    
    if (!textVal && imageEntries.length === 0) {
        if (ta) { ta.style.borderColor = 'var(--primary)'; ta.focus(); }
        return;
    }
    if (textVal.length > MAX_COMMENT_TEXT_LENGTH) {
        alert('评论最多 1000 个字符。');
        return;
    }
    if (imageEntries.length > MAX_COMMENT_IMAGE_COUNT
        || imageEntries.some(entry => !ALLOWED_COMMENT_IMAGE_TYPES.has(entry.file.type)
            || entry.file.size > MAX_COMMENT_IMAGE_BYTES)) {
        alert('评论最多 4 张图片；单张不超过 10MB，仅支持 JPG/PNG/WebP/GIF。');
        return;
    }

    const storageDirectory = getCommentStorageDirectory();
    if (!storageDirectory || typeof createStorageReference !== 'function') {
        alert('当前会话缺少空间信息，请重新登录后再试。');
        return;
    }

    const submitBtn = document.querySelector(`#comment-input-area-${momentId} .comment-submit-btn`);
    const origText = submitBtn ? submitBtn.textContent : '';
    commentSubmitRequests.add(momentId);
    if (submitBtn) { submitBtn.textContent = '发送中…'; submitBtn.disabled = true; }
    const uploadedObjectPaths = [];
    let databaseCommitted = false;

    try {
        let uploadedImgUrls = [];
        if (imageEntries.length > 0) {
            const uploadTasks = imageEntries.map(async (entry, index) => {
                let file = entry.file;
                if (typeof compressImageFile === 'function') {
                    file = await compressImageFile(file, 1280, 1280, 0.82);
                }
                const ext = getCommentFileExtension(file);
                const fileName = `${storageDirectory}/${Date.now()}_${index}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
                const { error: upErr } = await supabaseClient.storage.from('photos').upload(fileName, file, { contentType: file.type || 'application/octet-stream', upsert: false });
                if (upErr) throw upErr;
                return { fileName, ref: createStorageReference(fileName) };
            });
            const results = await Promise.all(uploadTasks);
            results.forEach(res => {
                uploadedObjectPaths.push(res.fileName);
                uploadedImgUrls.push(res.ref);
            });
        }
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) throw new Error('AUTH_CONTEXT_CHANGED');

        // 如果有图片，将内容存为 JSON（兼容旧纯文本格式）
        let content;
        if (uploadedImgUrls.length > 0) {
            content = JSON.stringify({ text: textVal, images: uploadedImgUrls });
        } else {
            content = textVal;
        }

        const { error } = await supabaseClient.from('comments').insert([{
            moment_id: momentId,
            content: content
        }]);

        if (error) throw error;
        databaseCommitted = true;
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;

        commentSubmitRequests.delete(momentId);
        cancelCommentInput(momentId);
        loadComments(momentId);
        loadCommentCounts([momentId]);
    } catch(err) {
        if (!databaseCommitted) await removeUploadedCommentObjects(uploadedObjectPaths);
        console.error('评论发送失败:', err);
        if (isCommentAuthEpochCurrent(requestAuthEpoch)) alert('评论发送失败，请稍后重试。');
    } finally {
        commentSubmitRequests.delete(momentId);
        if (submitBtn) { submitBtn.textContent = origText; submitBtn.disabled = false; }
    }
}

window.handleCommentImgSelect = function(event, momentId) {
    if (!hasCommentAuthContext()) return;
    const files = Array.from(event.target.files);
    if (!files.length) return;
    if (!commentImgFiles[momentId]) commentImgFiles[momentId] = [];
    const previewEl = document.getElementById(`comment-img-previews-${momentId}`);
    if (!previewEl) return;
    const availableSlots = Math.max(0, MAX_COMMENT_IMAGE_COUNT - commentImgFiles[momentId].length);
    const validFiles = files.filter(file => ALLOWED_COMMENT_IMAGE_TYPES.has(file.type)
        && file.size <= MAX_COMMENT_IMAGE_BYTES);
    const acceptedFiles = validFiles.slice(0, availableSlots);
    if (acceptedFiles.length !== files.length) {
        alert('评论最多 4 张图片；单张不超过 10MB，仅支持 JPG/PNG/WebP/GIF。');
    }
    acceptedFiles.forEach(file => {
        const objUrl = URL.createObjectURL(file);
        const entry = { id: nextCommentImageId++, file, objectUrl: objUrl };
        commentImgFiles[momentId].push(entry);
        const item = document.createElement('div');
        item.className = 'comment-img-preview-item';
        const image = document.createElement('img');
        image.src = objUrl;
        image.alt = '预览';
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'rm-btn';
        removeButton.textContent = '×';
        removeButton.setAttribute('aria-label', `移除 ${file.name}`);
        removeButton.addEventListener('click', () => removeCommentImg(momentId, entry.id, item));
        item.append(image, removeButton);
        previewEl.appendChild(item);
    });
    event.target.value = '';
};

window.removeCommentImg = function(momentId, entryId, itemEl) {
    const entries = commentImgFiles[momentId] || [];
    const index = entries.findIndex(entry => entry.id === entryId);
    if (index >= 0) {
        URL.revokeObjectURL(entries[index].objectUrl);
        entries.splice(index, 1);
    }
    if (entries.length === 0) delete commentImgFiles[momentId];
    if (itemEl) itemEl.remove();
};

window.addEventListener('pagehide', () => {
    clearAllCommentImageSelections();
});
