// --- 评论 ---
let commentImgFiles = {}; // momentId -> { id, file, objectUrl }[]
let nextCommentImageId = 1;
const commentLoadRequests = new Map();
const commentSubmitRequests = new Set();
const commentLikeInFlight = new Set();
const commentDeleteInFlight = new Set();
const commentLikesActorsCache = new Map(); // commentId -> actor[]
const commentLikePopTimers = new WeakMap();
const activeCommentReplies = new Map(); // momentId -> { commentId, author, snippet, isAI }
const activeAICommentReplies = new Set(); // momentId -> awaiting AI reply
const MAX_COMMENT_TEXT_LENGTH = 1000;
const MAX_COMMENT_IMAGE_COUNT = 4;
const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_COMMENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function triggerCommentLikePop(button, duration = 520) {
    if (!button) return;
    if (typeof window.triggerTransientPopClass === 'function') {
        window.triggerTransientPopClass(button, 'is-just-liked', duration);
        return;
    }
    const prev = commentLikePopTimers.get(button);
    if (prev) clearTimeout(prev);
    button.classList.remove('is-just-liked');
    void button.offsetWidth;
    button.classList.add('is-just-liked');
    const timer = setTimeout(() => {
        button.classList.remove('is-just-liked');
        commentLikePopTimers.delete(button);
    }, duration);
    commentLikePopTimers.set(button, timer);
}

function clearCommentLikePop(button) {
    if (!button) return;
    if (typeof window.clearTransientPopClass === 'function') {
        window.clearTransientPopClass(button, 'is-just-liked');
        return;
    }
    const prev = commentLikePopTimers.get(button);
    if (prev) {
        clearTimeout(prev);
        commentLikePopTimers.delete(button);
    }
    button.classList.remove('is-just-liked');
}

function syncMomentCommentCountDisplay(momentId, count) {
    const safeCount = Math.max(0, Number(count) || 0);
    const text = safeCount > 0 ? `${safeCount} 条评论` : '评论';
    const cards = document.querySelectorAll(`[id="card-${momentId}"]`);
    if (cards.length > 0) {
        cards.forEach(card => {
            const countEl = card.querySelector('.comment-toggle-btn span:last-child') || card.querySelector(`[id="comment-count-${momentId}"]`);
            if (countEl) countEl.innerText = text;
        });
    } else {
        const countEls = document.querySelectorAll(`[id="comment-count-${momentId}"]`);
        countEls.forEach(el => { el.innerText = text; });
    }
}

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

async function removeUploadedCommentObjects(pathsOrRefs) {
    if (!Array.isArray(pathsOrRefs) || !pathsOrRefs.length || !supabaseClient) return;
    const paths = pathsOrRefs.map(val => {
        if (typeof extractStorageObjectPath === 'function') {
            return extractStorageObjectPath(val);
        }
        if (typeof val === 'string' && typeof STORAGE_REFERENCE_PREFIX === 'string' && val.startsWith(STORAGE_REFERENCE_PREFIX)) {
            return typeof getStorageObjectPath === 'function' ? getStorageObjectPath(val) : '';
        }
        return (typeof val === 'string' && !val.startsWith('http') && !val.includes('avatars')) ? val : '';
    }).filter(Boolean);
    if (!paths.length) return;
    const uniquePaths = Array.from(new Set(paths));
    try {
        const { error } = await supabaseClient.storage.from('photos').remove(uniquePaths);
        if (error) console.error('清理评论图片失败:', error);
    } catch (err) {
        console.error('清理评论图片异常:', err);
    }
}

async function resolveCommentContent(rawContent) {
    let text = '';
    let imageValues = [];
    let isAI = false;
    let replyTo = null;
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            text = typeof parsed.text === 'string' ? parsed.text : '';
            imageValues = Array.isArray(parsed.images) ? parsed.images : [];
            isAI = Boolean(parsed.is_ai || parsed.ai_helper);
            if (parsed.reply_to && typeof parsed.reply_to === 'object') {
                const r = parsed.reply_to;
                replyTo = {
                    id: Number(r.id) || null,
                    author: String(r.author || ''),
                    text: String(r.text || ''),
                    isAI: Boolean(r.is_ai)
                };
            }
        } else {
            text = String(rawContent || '');
        }
    } catch (_error) {
        text = String(rawContent || '');
    }

    if (/^\s*🤖【感情小助手】/.test(text)) {
        isAI = true;
        text = text.replace(/^\s*🤖【感情小助手】[\s:：]*/, '');
    }

    const images = (await Promise.all(imageValues.map(async value => {
        try {
            const resolved = typeof resolveMediaUrl === 'function' ? await resolveMediaUrl(value) : value;
            return getCommentTrustedMediaUrl(resolved);
        } catch (_error) {
            return '';
        }
    }))).filter(Boolean);
    return { text, images, isAI, replyTo };
}

function setCommentStatus(container, text) {
    const status = document.createElement('div');
    status.className = 'comment-empty';
    status.textContent = text;
    container.replaceChildren(status);
}

function clearCommentImageSelection(momentId, targetCard = null) {
    (commentImgFiles[momentId] || []).forEach(entry => URL.revokeObjectURL(entry.objectUrl));
    delete commentImgFiles[momentId];
    const previewEls = targetCard
        ? targetCard.querySelectorAll('.comment-img-previews')
        : document.querySelectorAll(`[id="card-${momentId}"] .comment-img-previews, [id="comment-img-previews-${momentId}"]`);
    previewEls.forEach(el => el.replaceChildren());
}

function clearAllCommentImageSelections() {
    Object.keys(commentImgFiles).forEach(momentId => clearCommentImageSelection(momentId));
}

function checkPasswordForComment(momentId, triggerElement = null) {
    if (hasCommentAuthContext()) {
        showCommentInput(momentId, triggerElement);
        return;
    }
    if (typeof openLoginModal === 'function') openLoginModal();
}

function clearCommentReplyTarget(momentId, targetCard = null) {
    activeCommentReplies.delete(momentId);
    const card = targetCard?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const inputArea = card ? card.querySelector('.comment-input-area') : document.getElementById(`comment-input-area-${momentId}`);
    if (inputArea) {
        inputArea.querySelectorAll('.comment-reply-banner').forEach(el => el.remove());
        const ta = inputArea.querySelector('.comment-textarea');
        if (ta) ta.placeholder = '写下你的想法…';
    }
}

function startReplyToComment(momentId, replyTarget, triggerElement = null) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const card = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const section = card ? card.querySelector('.comment-section') : document.getElementById(`comments-${momentId}`);
    if (section && section.style.display === 'none') {
        section.style.display = 'block';
        section.setAttribute('aria-hidden', 'false');
        const toggleBtn = card ? card.querySelector('.comment-toggle-btn') : document.getElementById(`comment-toggle-${momentId}`);
        toggleBtn?.setAttribute('aria-expanded', 'true');
    }

    activeCommentReplies.set(momentId, replyTarget);
    showCommentInput(momentId, triggerElement, { isReply: true });

    const inputArea = card ? card.querySelector('.comment-input-area') : document.getElementById(`comment-input-area-${momentId}`);
    if (inputArea) {
        let banner = inputArea.querySelector('.comment-reply-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.className = 'comment-reply-banner';
            const ta = inputArea.querySelector('.comment-textarea');
            if (ta && ta.parentNode) {
                ta.parentNode.insertBefore(banner, ta);
            }
        }
        banner.replaceChildren();

        const contentDiv = document.createElement('div');
        contentDiv.className = 'comment-reply-banner-content';

        const icon = document.createElement('span');
        icon.className = 'comment-reply-banner-icon';
        icon.textContent = '↩️';

        const authorEl = document.createElement('span');
        authorEl.className = 'comment-reply-banner-author';
        authorEl.textContent = `回复 @${replyTarget.author}:`;

        const textEl = document.createElement('span');
        textEl.className = 'comment-reply-banner-text';
        const cleanSnippet = String(replyTarget.snippet || '').trim().replace(/\s+/g, ' ');
        textEl.textContent = cleanSnippet ? (cleanSnippet.length > 32 ? `${cleanSnippet.slice(0, 32)}…` : cleanSnippet) : '[图片]';

        contentDiv.append(icon, authorEl, textEl);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'comment-reply-banner-close';
        closeBtn.textContent = '×';
        closeBtn.title = '取消针对回复';
        closeBtn.setAttribute('aria-label', '取消针对回复');
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearCommentReplyTarget(momentId, card);
        });

        banner.append(contentDiv, closeBtn);

        const ta = inputArea.querySelector('.comment-textarea');
        if (ta) {
            ta.placeholder = `回复 @${replyTarget.author}…`;
            setTimeout(() => {
                ta.focus();
                banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 80);
        }
    }
}

function showCommentInput(momentId, triggerElement = null, { isReply = false } = {}) {
    if (!hasCommentAuthContext()) return;
    const card = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    if (!isReply) {
        clearCommentReplyTarget(momentId, card);
    }
    const writeBtn = card ? card.querySelector('.comment-write-btn') : document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = card ? card.querySelector('.comment-input-area') : document.getElementById(`comment-input-area-${momentId}`);
    if (writeBtn) writeBtn.style.display = 'none';
    if (inputArea) {
        inputArea.style.display = 'block';
        if (!inputArea.dataset.dropZoneBound && typeof window.registerDropAndPasteZone === 'function') {
            inputArea.dataset.dropZoneBound = 'true';
            window.registerDropAndPasteZone({
                target: inputArea,
                accept: 'image/*',
                promptText: '松开即可添加评论图片 🌸',
                promptIcon: '📸',
                isEnabled: () => inputArea.style.display !== 'none',
                onFiles: (files) => {
                    if (typeof window.handleCommentImgFiles === 'function') {
                        window.handleCommentImgFiles(files, momentId, card);
                    }
                }
            });
        }
        
        const avatarContainer = inputArea.querySelector('[id^="comment-input-avatar-"]') || inputArea.querySelector('div:first-child');
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

        const ta = inputArea.querySelector('.comment-textarea');
        if (ta) {
            ta.style.borderColor = '';
            if (!ta.dataset.borderCleanBound) {
                ta.dataset.borderCleanBound = 'true';
                ta.addEventListener('input', () => {
                    if (ta.style.borderColor) ta.style.borderColor = '';
                });
            }
            setTimeout(() => ta.focus(), 100);
        }
    }
}

function cancelCommentInput(momentId, triggerElement = null) {
    if (commentSubmitRequests.has(momentId)) {
        if (typeof showToast === 'function') showToast('评论正在发送，请稍候…');
        return;
    }
    const card = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const writeBtn = card ? card.querySelector('.comment-write-btn') : document.getElementById(`comment-write-btn-${momentId}`);
    const inputArea = card ? card.querySelector('.comment-input-area') : document.getElementById(`comment-input-area-${momentId}`);
    const ta = inputArea ? inputArea.querySelector('.comment-textarea') : document.getElementById(`comment-text-${momentId}`);
    if (ta) {
        ta.value = '';
        ta.style.borderColor = '';
    }
    clearCommentReplyTarget(momentId, card);
    if (inputArea) inputArea.style.display = 'none';
    if (writeBtn) writeBtn.style.display = 'inline-flex';
    // 清除图片选择
    clearCommentImageSelection(momentId, card);
    const fileInput = card ? card.querySelector('input[type="file"]') : document.getElementById(`comment-img-input-${momentId}`);
    if (fileInput) fileInput.value = '';
}

function applyCommentLikeButtonState(button, likeActors, isLiked) {
    if (!button) return;
    const actors = Array.isArray(likeActors) ? likeActors : [];
    const hasLikers = actors.length > 0;

    button.classList.toggle('liked', isLiked);
    button.classList.toggle('has-likers', hasLikers);
    button.setAttribute('aria-pressed', isLiked ? 'true' : 'false');

    const namesText = actors.map(actor => actor.displayName).join('、');
    const actionLabel = isLiked ? '取消点赞此评论' : '点赞此评论';
    button.setAttribute('aria-label', namesText ? `${actionLabel}（${namesText}已赞）` : actionLabel);
    if (namesText) {
        button.title = `${namesText} 已赞`;
    } else {
        button.removeAttribute('title');
    }

    const heart = button.querySelector('.like-heart');
    if (heart) {
        const targetEmoji = isLiked ? '❤️' : '🤍';
        if (heart.textContent !== targetEmoji) {
            heart.textContent = targetEmoji;
        }
    }

    const contentEl = button.querySelector('.like-count');
    if (!contentEl) return;

    const fragment = document.createDocumentFragment();
    if (!hasLikers) {
        const prompt = document.createElement('span');
        prompt.className = 'like-action-prompt';
        prompt.textContent = '赞';
        fragment.appendChild(prompt);
    } else {
        if (!isLiked) {
            const prompt = document.createElement('span');
            prompt.className = 'like-action-prompt';
            prompt.textContent = '赞';
            const divider = document.createElement('span');
            divider.className = 'like-actors-divider';
            divider.setAttribute('aria-hidden', 'true');
            divider.textContent = '·';
            fragment.append(prompt, divider);
        }
        actors.forEach(actor => {
            if (typeof window.createLikeActorBadgeElement === 'function') {
                fragment.appendChild(window.createLikeActorBadgeElement(actor, { variant: 'comment' }));
            }
        });
    }
    contentEl.replaceChildren(fragment);
}

function toggleComments(momentId, triggerElement = null) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const card = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const section = card ? card.querySelector('.comment-section') : document.getElementById(`comments-${momentId}`);
    if (!section) return;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    section.setAttribute('aria-hidden', String(!isHidden));

    const toggleBtn = card ? card.querySelector('.comment-toggle-btn') : document.getElementById(`comment-toggle-${momentId}`);
    toggleBtn?.setAttribute('aria-expanded', String(isHidden));

    if (isHidden) {
        section.classList.remove('is-entering');
        void section.offsetWidth;
        section.classList.add('is-entering');
        loadComments(momentId, card);
    } else {
        section.classList.remove('is-entering');
    }
}

async function loadComments(momentId, targetCard = null, options = {}) {
    if (!hasCommentAuthContext()) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const requestId = (commentLoadRequests.get(momentId) || 0) + 1;
    commentLoadRequests.set(momentId, requestId);

    const getListElements = () => {
        if (targetCard) {
            const el = targetCard.querySelector('.comment-list');
            return el ? [el] : [];
        }
        const cards = document.querySelectorAll(`[id="card-${momentId}"]`);
        if (cards.length > 0) {
            return Array.from(cards).map(c => c.querySelector('.comment-list')).filter(Boolean);
        }
        return Array.from(document.querySelectorAll(`[id="comment-list-${momentId}"]`));
    };

    const listEls = getListElements();
    if (!listEls.length) return;
    // 保留已有评论列表避免清空闪烁；仅在列表尚无评论条目时显示加载提示
    listEls.forEach(listEl => {
        if (!listEl.querySelector('.comment-item')) {
            setCommentStatus(listEl, '加载中…');
        }
    });

    const { data, error } = await supabaseClient.from('comments')
        .select('id, moment_id, user_id, author, content, created_at')
        .eq('moment_id', momentId)
        .order('created_at', { ascending: true });

    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;
    const currentListEls = getListElements();
    if (error) {
        currentListEls.forEach(listEl => {
            if (!listEl.querySelector('.comment-item')) {
                setCommentStatus(listEl, '加载失败 😢');
            }
        });
        return;
    }

    if (!data || !data.length) {
        currentListEls.forEach(listEl => setCommentStatus(listEl, '还没有评论，来说点什么吧 ✨'));
        return;
    }

    // 并行获取评论点赞与批量签名评论图片，消除串行等待
    const commentIds = data.map(c => c.id);
    const allCommentImageRefs = [];
    data.forEach(comment => {
        if (!comment || typeof comment.content !== 'string') return;
        const trimmed = comment.content.trim();
        if (!trimmed.startsWith('{')) return;
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && Array.isArray(parsed.images)) {
                parsed.images.forEach(img => {
                    if (typeof img === 'string' && img.trim()) {
                        allCommentImageRefs.push(img.trim());
                    }
                });
            }
        } catch (_e) {}
    });

    const [{ data: likesData, error: likesError }] = await Promise.all([
        supabaseClient.from('comment_likes')
            .select('comment_id, user_id, author')
            .in('comment_id', commentIds),
        (allCommentImageRefs.length > 0 && typeof batchResolveMediaUrls === 'function')
            ? batchResolveMediaUrls(allCommentImageRefs).catch(() => {})
            : Promise.resolve()
    ]);
    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;

    const likeRowsMap = {};
    const userLikedMap = {};
    if (!likesError && likesData) {
        likesData.forEach(l => {
            if (!likeRowsMap[l.comment_id]) likeRowsMap[l.comment_id] = [];
            likeRowsMap[l.comment_id].push(l);
            if (currentAuthUser && l.user_id === currentAuthUser.id) userLikedMap[l.comment_id] = true;
        });
    }

    const resolvedContents = await Promise.all(data.map(comment => resolveCommentContent(comment.content)));
    if (!isCommentAuthEpochCurrent(requestAuthEpoch) || commentLoadRequests.get(momentId) !== requestId) return;

    currentListEls.forEach(listEl => {
        const prevItemIds = new Set(
            Array.from(listEl.querySelectorAll('.comment-item')).map(el => el.id).filter(Boolean)
        );
        const wasInitiallyEmpty = prevItemIds.size === 0;
        const activeThinking = listEl.querySelector('.comment-ai-thinking');
        const fragment = document.createDocumentFragment();
        data.forEach((c, commentIndex) => {
            const commentId = Number(c.id);
            if (!Number.isSafeInteger(commentId) || commentId <= 0) return;
            const createdAt = new Date(c.created_at);
            const friendlyDateStr = typeof formatFriendlyTime === 'function'
                ? formatFriendlyTime(createdAt)
                : (!Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString('zh-CN') : '');
            const fullDateStr = typeof formatFullTime === 'function'
                ? formatFullTime(createdAt)
                : (!Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString('zh-CN', { hour12: false }) : '');
            const badgeClass = c.author === '小蛇' ? 'author-snake' : 'author-xi';
            const emoji = c.author === '小蛇' ? '🐍' : '🐟';
            
            const p = allProfilesCache[c.author] || {};
            const displayName = p.nickname || c.author;
            
            const likeActors = typeof window.resolveLikeActors === 'function' ? window.resolveLikeActors(likeRowsMap[c.id] || []) : [];
            const isLiked = Boolean(userLikedMap[c.id]);
            commentLikesActorsCache.set(commentId, likeActors);

            const textContent = resolvedContents[commentIndex].text;
            const imageUrls = resolvedContents[commentIndex].images;

            const isAIComment = Boolean(resolvedContents[commentIndex].isAI);
            const domId = `comment-${commentId}`;
            const shouldAnimateEnter = options?.animateNewCommentId === commentId
                || (!wasInitiallyEmpty && !prevItemIds.has(domId));

            const item = document.createElement('div');
            item.className = `comment-item${isAIComment ? ' comment-item--ai' : ''}${shouldAnimateEnter ? ' comment-item--enter' : ''}`;
            item.id = domId;
            if (shouldAnimateEnter) {
                setTimeout(() => item.classList.remove('comment-item--enter'), 380);
            }
            const authorBadge = document.createElement('span');

            if (isAIComment) {
                authorBadge.className = 'comment-author-badge author-badge author-ai';
                authorBadge.title = `${displayName} 请求感情小助手智能点评 ✨`;
                authorBadge.tabIndex = 0;
                authorBadge.appendChild(document.createTextNode('🤖 感情小助手'));
            } else {
                authorBadge.className = `comment-author-badge author-badge ${badgeClass}`;
                authorBadge.style.cursor = 'var(--cursor-pointer)';
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
            }

            const header = document.createElement('div');
            header.className = 'comment-header';
            header.appendChild(authorBadge);

            const body = document.createElement('div');
            body.className = 'comment-body';
            const bubble = document.createElement('div');
            bubble.className = `comment-bubble${isAIComment ? ' comment-bubble--ai' : ''}`;
            const commentResolved = resolvedContents[commentIndex] || {};

            const replyTo = commentResolved.replyTo;
            if (replyTo && replyTo.author) {
                const quote = document.createElement('div');
                quote.className = 'comment-reply-quote';

                const quoteAuthor = document.createElement('span');
                quoteAuthor.className = 'reply-quote-author';
                quoteAuthor.textContent = `@${replyTo.author}：`;

                const quoteText = document.createElement('span');
                quoteText.className = 'reply-quote-text';
                const cleanQuote = String(replyTo.text || '').replace(/\s+/g, ' ');
                quoteText.textContent = cleanQuote ? (cleanQuote.length > 50 ? `${cleanQuote.slice(0, 50)}…` : cleanQuote) : '[图片]';

                quote.append(quoteAuthor, quoteText);

                if (replyTo.id) {
                    quote.title = '点击跳转查看被回复的评论';
                    quote.tabIndex = 0;
                    const jumpToTarget = () => {
                        const targetEl = document.getElementById(`comment-${replyTo.id}`);
                        if (targetEl) {
                            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            targetEl.classList.add('comment-item--highlight');
                            setTimeout(() => targetEl.classList.remove('comment-item--highlight'), 2000);
                        } else if (typeof showToast === 'function') {
                            showToast('被回复的原评论已被撤回或不存在');
                        }
                    };
                    quote.addEventListener('click', jumpToTarget);
                    quote.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            jumpToTarget();
                        }
                    });
                }
                bubble.appendChild(quote);
            }

            if (textContent) bubble.appendChild(document.createTextNode(textContent));
            imageUrls.forEach((url, imgIdx) => {
                const image = document.createElement('img');
                image.src = url;
                image.alt = '评论图片';
                image.crossOrigin = 'anonymous';
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
                    if (typeof openLightbox === 'function') {
                        openLightbox(url, { gallery: imageUrls, initialIndex: imgIdx });
                    }
                });
                bubble.appendChild(image);
            });

            const time = document.createElement('div');
            time.className = 'comment-time';

            const timeTextEl = document.createElement('span');
            timeTextEl.className = 'comment-time-text';
            timeTextEl.textContent = friendlyDateStr;
            if (fullDateStr) timeTextEl.title = fullDateStr;
            time.appendChild(timeTextEl);

            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'comment-actions';

            const likeButton = document.createElement('button');
            likeButton.type = 'button';
            likeButton.className = 'comment-like-btn';
            likeButton.id = `like-btn-${commentId}`;
            const heart = document.createElement('span');
            heart.className = 'like-heart';
            heart.setAttribute('aria-hidden', 'true');
            const count = document.createElement('span');
            count.className = 'like-count';
            count.id = `like-count-${commentId}`;
            likeButton.append(heart, count);
            applyCommentLikeButtonState(likeButton, likeActors, isLiked);
            likeButton.addEventListener('click', () => toggleCommentLike(commentId, momentId, likeButton));
            actionsWrap.appendChild(likeButton);

            const replyButton = document.createElement('button');
            replyButton.type = 'button';
            replyButton.className = 'comment-reply-btn';
            const replyIcon = document.createElement('span');
            replyIcon.className = 'reply-btn-icon';
            replyIcon.textContent = '↩';
            const replyText = document.createElement('span');
            replyText.className = 'reply-btn-text';
            replyText.textContent = '回复';
            replyButton.append(replyIcon, replyText);
            replyButton.setAttribute('aria-label', `回复 ${isAIComment ? '感情小助手' : displayName}`);
            replyButton.addEventListener('click', () => {
                startReplyToComment(momentId, {
                    commentId,
                    author: isAIComment ? '感情小助手' : displayName,
                    snippet: textContent || (imageUrls.length ? '[图片]' : ''),
                    isAI: isAIComment
                }, item);
            });
            actionsWrap.appendChild(replyButton);

            if (currentAuthUser && c.user_id === currentAuthUser.id) {
                const recall = document.createElement('button');
                recall.type = 'button';
                recall.className = 'comment-recall-btn';
                const recallIcon = document.createElement('span');
                recallIcon.className = 'recall-btn-icon';
                recallIcon.textContent = '🗑️';
                const recallText = document.createElement('span');
                recallText.className = 'recall-btn-text';
                recallText.textContent = '撤回';
                recall.append(recallIcon, recallText);
                recall.setAttribute('aria-label', '撤回此评论');
                recall.addEventListener('click', () => confirmDeleteComment(commentId, momentId));
                actionsWrap.appendChild(recall);
            }
            time.appendChild(actionsWrap);
            body.append(bubble, time);
            item.append(header, body);
            fragment.appendChild(item);
        });
        listEl.replaceChildren(fragment);
        if (activeThinking && activeAICommentReplies.has(momentId)) {
            listEl.appendChild(activeThinking);
        }
    });

    if (Array.isArray(data) && data.length > 0) {
        syncMomentCommentCountDisplay(momentId, data.length);
        const commentIds = data.map(c => c.id);
        if (typeof window.autoMarkCommentsNotificationRead === 'function') {
            window.autoMarkCommentsNotificationRead(momentId, commentIds);
        }
    }
}

function confirmDeleteComment(commentId, momentId) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    return deleteComment(commentId, momentId);
}

// --- 评论点赞（零延迟乐观更新 + 失败自动回滚） ---
async function toggleCommentLike(commentId, momentId, triggerElement = null) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const lockKey = String(commentId ?? '').trim();
    if (!lockKey || commentLikeInFlight.has(lockKey)) return;
    if (!currentAuthUser || !currentAuthUser.id) return;
    commentLikeInFlight.add(lockKey);

    const normalizedCommentId = Number(commentId);
    const btns = Array.from(document.querySelectorAll(`[id="like-btn-${commentId}"]`));
    btns.forEach(btn => btn.setAttribute('aria-busy', 'true'));

    const requestAuthEpoch = getCommentAuthEpoch();
    const userId = currentAuthUser.id;
    const authorName = typeof currentAuthor === 'string' ? currentAuthor : '';
    const isLiked = btns.length ? btns[0].classList.contains('liked') : false;
    const nextLiked = !isLiked;
    const prevActors = commentLikesActorsCache.get(normalizedCommentId) || [];

    let optimisticActors = prevActors;
    if (typeof window.buildOptimisticActors === 'function') {
        optimisticActors = window.buildOptimisticActors(prevActors, userId, authorName, nextLiked);
    } else if (typeof window.resolveLikeActors === 'function') {
        const filtered = prevActors.filter(a => a && a.userId !== userId && (!authorName || a.username !== authorName));
        if (nextLiked) {
            const selfActors = window.resolveLikeActors([{ user_id: userId, author: authorName }]);
            optimisticActors = [...filtered, ...selfActors].sort((a, b) => (a.sortOrder ?? 2) - (b.sortOrder ?? 2));
        } else {
            optimisticActors = filtered;
        }
    }

    if (Number.isSafeInteger(normalizedCommentId)) {
        commentLikesActorsCache.set(normalizedCommentId, optimisticActors);
    }
    btns.forEach(btn => applyCommentLikeButtonState(btn, optimisticActors, nextLiked));

    if (nextLiked) {
        btns.forEach(btn => triggerCommentLikePop(btn, 520));
        const targetBtn = triggerElement?.closest?.('.comment-like-btn') || triggerElement || btns[0];
        if (targetBtn && typeof spawnHearts === 'function') {
            const rect = targetBtn.getBoundingClientRect();
            spawnHearts(rect.left + rect.width / 2, rect.top);
        }
    } else {
        btns.forEach(btn => clearCommentLikePop(btn));
    }

    try {
        let error = null;
        if (isLiked) {
            const res = await supabaseClient.from('comment_likes')
                .delete()
                .eq('comment_id', commentId)
                .eq('user_id', userId);
            error = res.error;
            if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
            if (!error && currentAuthUser) {
                await supabaseClient.from('notifications')
                    .update({ type: 'recalled', content: '此点赞互动已被对方撤回' })
                    .eq('type', 'like')
                    .eq('related_id', commentId.toString())
                    .eq('actor_id', userId);
                if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
            }
        } else {
            const res = await supabaseClient.from('comment_likes')
                .insert([{ comment_id: commentId }]);
            error = res.error;
        }
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
        if (error) throw error;

        // 静默校准该评论的点赞状态
        await updateSingleLike(commentId);
    } catch (error) {
        console.error('评论点赞失败:', error);
        if (isCommentAuthEpochCurrent(requestAuthEpoch)) {
            if (Number.isSafeInteger(normalizedCommentId)) {
                commentLikesActorsCache.set(normalizedCommentId, prevActors);
            }
            const currentBtns = document.querySelectorAll(`[id="like-btn-${commentId}"]`);
            currentBtns.forEach(btn => {
                clearCommentLikePop(btn);
                applyCommentLikeButtonState(btn, prevActors, isLiked);
            });
            if (typeof window.showToast === 'function') {
                window.showToast('点赞未成功，请稍后重试 🌸');
            }
        }
    } finally {
        commentLikeInFlight.delete(lockKey);
        document.querySelectorAll(`[id="like-btn-${commentId}"]`).forEach(btn => btn.removeAttribute('aria-busy'));
    }
}

async function updateSingleLike(commentId) {
    if (!hasCommentAuthContext()) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const btns = document.querySelectorAll(`[id="like-btn-${commentId}"]`);
    if (!btns.length) return;

    const { data, error } = await supabaseClient.from('comment_likes')
        .select('user_id, author')
        .eq('comment_id', commentId);

    if (error || !isCommentAuthEpochCurrent(requestAuthEpoch)) return;

    const rows = Array.isArray(data) ? data : [];
    const likeActors = typeof window.resolveLikeActors === 'function' ? window.resolveLikeActors(rows) : [];
    const userLiked = Boolean(currentAuthUser && rows.some(l => l.user_id === currentAuthUser.id));
    const normalizedId = Number(commentId);
    if (Number.isSafeInteger(normalizedId)) {
        commentLikesActorsCache.set(normalizedId, likeActors);
    }

    btns.forEach(btn => applyCommentLikeButtonState(btn, likeActors, userLiked));
}

async function deleteComment(commentId, momentId, options = {}) {
    if (!hasCommentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    const normalizedCommentId = Number(commentId);
    if (!Number.isSafeInteger(normalizedCommentId) || normalizedCommentId <= 0) return;
    if (commentDeleteInFlight.has(normalizedCommentId)) return;

    if (options?.skipConfirm !== true) {
        const confirmed = typeof window.showConfirmDialog === 'function'
            ? await window.showConfirmDialog('确定要撤回这条评论吗？', {
                title: '撤回评论',
                confirmText: '撤回',
                danger: true
            })
            : false;
        if (!confirmed) return;
        if (!hasCommentAuthContext() || commentDeleteInFlight.has(normalizedCommentId)) return;
    }

    commentDeleteInFlight.add(normalizedCommentId);

    try {
        const requestAuthEpoch = getCommentAuthEpoch();

        // 撤回前收集该评论所包含的图片（用于物理清理，杜绝孤儿文件）
        let mediaToDelete = [];
        try {
            const { data: cRow } = await supabaseClient
                .from('comments')
                .select('content')
                .eq('id', normalizedCommentId)
                .maybeSingle();
            if (cRow && cRow.content) {
                try {
                    const parsed = JSON.parse(cRow.content);
                    if (parsed && Array.isArray(parsed.images)) {
                        mediaToDelete = parsed.images;
                    }
                } catch (_) {}
            }
        } catch (collectErr) {
            console.warn('收集待撤回评论媒体失败:', collectErr);
        }

        const { data: deleted, error } = await supabaseClient.rpc('recall_and_delete_comment', {
            p_comment_id: normalizedCommentId
        });
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;
        if (error || deleted !== true) {
            console.error('撤回评论失败:', error);
            if (typeof window.showToast === 'function') {
                window.showToast('撤回评论失败，请稍后重试 🌸');
            }
        } else {
            // 撤回成功后，物理清理该评论包含的图片
            if (mediaToDelete.length > 0) {
                removeUploadedCommentObjects(mediaToDelete);
            }
            commentLikesActorsCache.delete(normalizedCommentId);
            if (activeCommentReplies.get(momentId)?.commentId === normalizedCommentId) {
                clearCommentReplyTarget(momentId);
            }

            const items = Array.from(document.querySelectorAll(`[id="comment-${normalizedCommentId}"]`));
            const affectedLists = new Set();
            items.forEach(item => {
                const listEl = item.closest('.comment-list');
                if (listEl) affectedLists.add(listEl);
            });

            const finalizeCommentRemoval = () => {
                items.forEach(item => item.remove());
                let remainingInFirstList = null;
                affectedLists.forEach(listEl => {
                    const remainingItems = listEl.querySelectorAll('.comment-item').length;
                    if (remainingInFirstList === null) remainingInFirstList = remainingItems;
                    if (remainingItems === 0 && !listEl.querySelector('.comment-ai-thinking')) {
                        setCommentStatus(listEl, '还没有评论，来说点什么吧 ✨');
                    }
                });
                if (remainingInFirstList !== null) {
                    syncMomentCommentCountDisplay(momentId, remainingInFirstList);
                }
                loadCommentCounts([momentId]);
            };

            const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
            if (!items.length || reduceMotion) {
                finalizeCommentRemoval();
            } else {
                items.forEach(item => {
                    const startHeight = item.getBoundingClientRect().height;
                    const computed = window.getComputedStyle(item);
                    item.style.overflow = 'hidden';
                    item.style.pointerEvents = 'none';
                    item.style.maxHeight = `${startHeight}px`;
                    item.style.marginBottom = computed.marginBottom;
                    item.style.paddingTop = computed.paddingTop;
                    item.style.paddingBottom = computed.paddingBottom;
                    void item.offsetHeight;
                    item.style.transition = [
                        'opacity 200ms ease',
                        'transform 260ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
                        'max-height 260ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
                        'margin-bottom 260ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
                        'padding-top 260ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
                        'padding-bottom 260ms var(--ios-ease-decel, cubic-bezier(0.22, 1, 0.36, 1))',
                        'border-width 260ms ease'
                    ].join(', ');
                    requestAnimationFrame(() => {
                        item.style.opacity = '0';
                        item.style.transform = 'translateX(-12px) scale(0.98)';
                        item.style.maxHeight = '0px';
                        item.style.marginBottom = '0px';
                        item.style.paddingTop = '0px';
                        item.style.paddingBottom = '0px';
                        item.style.borderTopWidth = '0px';
                        item.style.borderBottomWidth = '0px';
                    });
                });
                setTimeout(finalizeCommentRemoval, 270);
            }
        }
    } finally {
        commentDeleteInFlight.delete(normalizedCommentId);
    }
}

async function loadCommentCounts(momentIds, options = {}) {
    if (!hasCommentAuthContext() || !momentIds.length) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const queryPromise = supabaseClient.from('comments')
        .select('moment_id')
        .in('moment_id', momentIds);
    const [{ data, error }, domReady] = await Promise.all([
        queryPromise,
        options?.domReadyPromise ? options.domReadyPromise : Promise.resolve(true)
    ]);

    if (!domReady || error || !isCommentAuthEpochCurrent(requestAuthEpoch)) return;

    const counts = {};
    data.forEach(c => { counts[c.moment_id] = (counts[c.moment_id] || 0) + 1; });

    momentIds.forEach(id => {
        syncMomentCommentCountDisplay(id, counts[id] || 0);
    });
}

async function submitComment(momentId, triggerElement = null) {
    if (!hasCommentAuthContext() || commentSubmitRequests.has(momentId)) return;
    const requestAuthEpoch = getCommentAuthEpoch();
    const card = triggerElement?.closest('.moment-card') || document.getElementById(`card-${momentId}`);
    const inputArea = card ? card.querySelector('.comment-input-area') : document.getElementById(`comment-input-area-${momentId}`);
    const ta = inputArea ? inputArea.querySelector('.comment-textarea') : document.getElementById(`comment-text-${momentId}`);
    const textVal = ta ? ta.value.trim() : '';
    const imageEntries = commentImgFiles[momentId] || [];
    
    if (!textVal && imageEntries.length === 0) {
        if (typeof window.showToast === 'function') {
            window.showToast('写点内容或选张照片再发送吧 🌸');
        }
        if (ta) {
            ta.style.borderColor = '';
            ta.focus();
        }
        return;
    }
    if (textVal.length > MAX_COMMENT_TEXT_LENGTH) {
        if (typeof window.showToast === 'function') {
            window.showToast('评论最多 1000 个字符哦 ✨');
        }
        return;
    }
    if (imageEntries.length > MAX_COMMENT_IMAGE_COUNT
        || imageEntries.some(entry => !ALLOWED_COMMENT_IMAGE_TYPES.has(entry.file.type)
            || entry.file.size > MAX_COMMENT_IMAGE_BYTES)) {
        if (typeof window.showToast === 'function') {
            window.showToast('评论最多 4 张图片，单张不超过 10MB（JPG/PNG/WebP/GIF）📸');
        }
        return;
    }

    const storageDirectory = getCommentStorageDirectory();
    if (!storageDirectory || typeof createStorageReference !== 'function') {
        if (typeof window.showToast === 'function') {
            window.showToast('当前会话缺少空间信息，请重新登录后再试 🌸');
        }
        return;
    }

    const submitBtn = inputArea ? inputArea.querySelector('.comment-submit-btn') : document.querySelector(`#comment-input-area-${momentId} .comment-submit-btn`);
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

        // 如果有图片或回复引用，将内容存为 JSON（兼容旧纯文本格式）
        const replyTarget = activeCommentReplies.get(momentId) || null;
        let content;
        if (replyTarget || uploadedImgUrls.length > 0) {
            const payload = { text: textVal };
            if (replyTarget) {
                payload.reply_to = {
                    id: replyTarget.commentId,
                    author: replyTarget.author,
                    text: replyTarget.snippet,
                    is_ai: Boolean(replyTarget.isAI)
                };
            }
            if (uploadedImgUrls.length > 0) {
                payload.images = uploadedImgUrls;
            }
            content = JSON.stringify(payload);
        } else {
            content = textVal;
        }

        const { data: insertedData, error } = await supabaseClient.from('comments').insert([{
            moment_id: momentId,
            content: content
        }]).select('id');

        if (error) throw error;
        databaseCommitted = true;
        if (!isCommentAuthEpochCurrent(requestAuthEpoch)) return;

        const newCommentId = insertedData && insertedData[0] ? Number(insertedData[0].id) : null;
        const triggerAI = Boolean(replyTarget && replyTarget.isAI);
        const savedReplyTarget = replyTarget;

        activeCommentReplies.delete(momentId);
        commentSubmitRequests.delete(momentId);
        cancelCommentInput(momentId, triggerElement);
        await loadComments(momentId, null, { animateNewCommentId: newCommentId });
        await loadCommentCounts([momentId]);

        if (triggerAI) {
            handleAICommentContinuation({
                momentId,
                userCommentId: newCommentId,
                userCommentText: textVal,
                repliedCommentId: savedReplyTarget.commentId
            });
        }
    } catch(err) {
        if (!databaseCommitted) await removeUploadedCommentObjects(uploadedObjectPaths);
        console.error('评论发送失败:', err);
        if (isCommentAuthEpochCurrent(requestAuthEpoch) && typeof window.showToast === 'function') {
            window.showToast('评论发送失败，请稍后重试 🌸');
        }
    } finally {
        commentSubmitRequests.delete(momentId);
        if (submitBtn) { submitBtn.textContent = origText; submitBtn.disabled = false; }
    }
}

async function handleAICommentContinuation({ momentId, userCommentId, userCommentText, repliedCommentId }) {
    if (activeAICommentReplies.has(momentId)) return;
    activeAICommentReplies.add(momentId);

    const getListElements = () => {
        const cards = document.querySelectorAll(`[id="card-${momentId}"]`);
        if (cards.length > 0) {
            return Array.from(cards).map(c => c.querySelector('.comment-list')).filter(Boolean);
        }
        return Array.from(document.querySelectorAll(`[id="comment-list-${momentId}"]`));
    };

    const thinkingEls = [];
    getListElements().forEach(listEl => {
        const thinkingEl = document.createElement('div');
        thinkingEl.className = 'comment-ai-thinking';
        thinkingEl.id = `comment-ai-thinking-${momentId}`;

        const icon = document.createElement('span');
        icon.textContent = '🤖';

        const label = document.createElement('span');
        label.textContent = '感情小助手正在思考回复…';

        const dots = document.createElement('span');
        dots.className = 'comment-ai-thinking-dots';
        dots.innerHTML = '<span></span><span></span><span></span>';

        thinkingEl.append(icon, label, dots);
        listEl.appendChild(thinkingEl);
        thinkingEls.push(thinkingEl);
    });

    try {
        if (typeof continueAICommentConversation === 'function') {
            await continueAICommentConversation({
                momentId,
                userCommentId,
                userCommentText,
                repliedCommentId
            });
        } else {
            console.warn('[感情助手] continueAICommentConversation 函数未就绪');
        }
    } catch (err) {
        console.error('[感情助手] 评论继续对话失败:', err);
        if (typeof showToast === 'function') {
            showToast('感情小助手走神啦，稍后再试试回复它吧～');
        }
    } finally {
        activeAICommentReplies.delete(momentId);
        thinkingEls.forEach(el => el.remove());
    }
}

window.handleCommentImgFiles = function(files, momentId, card = null) {
    if (!hasCommentAuthContext()) return;
    const fileList = Array.from(files || []);
    if (!fileList.length) return;
    if (!commentImgFiles[momentId]) commentImgFiles[momentId] = [];
    const targetCard = card || document.getElementById(`card-${momentId}`);
    const previewEl = targetCard ? targetCard.querySelector('.comment-img-previews') : document.getElementById(`comment-img-previews-${momentId}`);
    if (!previewEl) return;
    const availableSlots = Math.max(0, MAX_COMMENT_IMAGE_COUNT - commentImgFiles[momentId].length);
    const validFiles = fileList.filter(file => ALLOWED_COMMENT_IMAGE_TYPES.has(file.type)
        && file.size <= MAX_COMMENT_IMAGE_BYTES);
    const acceptedFiles = validFiles.slice(0, availableSlots);
    if (acceptedFiles.length !== fileList.length) {
        if (typeof window.showToast === 'function') {
            window.showToast('评论最多 4 张图片，单张不超过 10MB（JPG/PNG/WebP/GIF）📸');
        }
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
};

window.handleCommentImgSelect = function(event, momentId) {
    if (!hasCommentAuthContext()) return;
    const files = Array.from(event?.target?.files || []);
    if (!files.length) return;
    const card = event.target.closest('.moment-card');
    window.handleCommentImgFiles(files, momentId, card);
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

async function submitAIAnalysisComment(momentId, commentText) {
    if (!hasCommentAuthContext()) {
        throw new Error('AUTH_REQUIRED');
    }
    const cleanText = String(commentText || '').trim();
    if (!cleanText) {
        throw new Error('COMMENT_EMPTY');
    }

    const payload = JSON.stringify({
        text: cleanText,
        is_ai: true,
        ai_helper: 'love_assistant'
    });

    const { data: insertedRows, error } = await supabaseClient
        .from('comments')
        .insert([{
            moment_id: momentId,
            content: payload
        }])
        .select('id');

    if (error) throw error;
    const newCommentId = Array.isArray(insertedRows) && insertedRows[0]?.id
        ? Number(insertedRows[0].id)
        : null;

    // 成功后自动展开所有同 ID 卡片的评论列表，并刷新评论数据和计数
    const cards = Array.from(document.querySelectorAll(`[id="card-${momentId}"]`));
    if (cards.length > 0) {
        cards.forEach(card => {
            const section = card.querySelector('.comment-section');
            if (section) {
                section.style.display = 'block';
                section.setAttribute('aria-hidden', 'false');
            }
            const toggleBtn = card.querySelector('.comment-toggle-btn');
            toggleBtn?.setAttribute('aria-expanded', 'true');
        });
    } else {
        const section = document.getElementById(`comments-${momentId}`);
        if (section) {
            section.style.display = 'block';
            section.setAttribute('aria-hidden', 'false');
            const toggleBtn = document.getElementById(`comment-toggle-${momentId}`);
            toggleBtn?.setAttribute('aria-expanded', 'true');
        }
    }

    await loadComments(momentId, null, { animateNewCommentId: newCommentId });
    await loadCommentCounts([momentId]);

    // 定位并高亮最新生成的 AI 评论，确保用户在长图文卡片中立即感知到结果
    const targetItem = (newCommentId && document.getElementById(`comment-${newCommentId}`))
        || document.querySelector(`[id="card-${momentId}"] .comment-list .comment-item:last-child`);
    if (targetItem) {
        targetItem.classList.remove('comment-item--enter', 'comment-item--highlight');
        void targetItem.offsetWidth;
        targetItem.classList.add('comment-item--highlight');
        setTimeout(() => targetItem.classList.remove('comment-item--highlight'), 2100);
        if (typeof targetItem.scrollIntoView === 'function') {
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
}

window.submitAIAnalysisComment = submitAIAnalysisComment;
window.startReplyToComment = startReplyToComment;
window.clearCommentReplyTarget = clearCommentReplyTarget;
