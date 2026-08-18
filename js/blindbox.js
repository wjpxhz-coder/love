// ==========================================
// 回忆盲盒与摇一摇
// ==========================================
let isBlindBoxLoading = false;
let shakeLastTime = 0;
let lastX = 0;
let lastY = 0;
let lastZ = 0;
let deviceMotionRegistered = false;
let blindBoxGeneration = 0;

function isBlindBoxSnapshotCurrent(epoch, userId, generation) {
    return generation === blindBoxGeneration && isCurrentAuthSnapshot(epoch, userId);
}

function setBlindBoxMessage(message) {
    const content = document.getElementById('blindBoxContent');
    if (!content) return;
    content.replaceChildren();
    const messageElement = document.createElement('div');
    messageElement.className = 'blind-box-status';
    messageElement.textContent = message;
    content.appendChild(messageElement);
}

async function registerDeviceMotion(epoch, userId, generation) {
    if (deviceMotionRegistered) return true;
    if (typeof DeviceMotionEvent === 'undefined') return false;

    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const permission = await DeviceMotionEvent.requestPermission();
        if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return false;
        if (permission !== 'granted') return false;
    }

    if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return false;
    window.addEventListener('devicemotion', handleShake, { passive: true });
    deviceMotionRegistered = true;
    return true;
}

async function triggerBlindBox(requestPermission = false) {
    if (!isAuthenticated()) {
        if (typeof appNavigate === 'function') appNavigate('/memories/blind-box');
        else window.location.hash = '#/memories/blind-box';
        return;
    }

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const generation = blindBoxGeneration;

    if (requestPermission && !deviceMotionRegistered) {
        try {
            const registered = await registerDeviceMotion(epoch, userId, generation);
            if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return;
            if (!registered && typeof showToast === 'function') showToast('未启用摇一摇，仍可点击抽取回忆');
        } catch (error) {
            if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return;
            console.error('申请体感权限失败:', error);
            if (typeof showToast === 'function') showToast('未获得体感权限，仍可点击抽取回忆');
        }
    }

    if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return;
    if (typeof isAppRouteActive === 'function' && isAppRouteActive('blindbox')) {
        fetchRandomMoment();
    } else if (typeof appNavigate === 'function') {
        appNavigate('/memories/blind-box');
    } else {
        window.location.hash = '#/memories/blind-box';
    }
}

function enterBlindBoxPage() {
    if (!isAuthenticated()) return;
    fetchRandomMoment();
}

function leaveBlindBoxPage() {
    const content = document.getElementById('blindBoxContent');
    if (content && typeof releaseMomentVideosWithin === 'function') {
        releaseMomentVideosWithin(content, true);
    }
    cleanupBlindBox();
}

function closeBlindBox() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
}

function cleanupBlindBox() {
    blindBoxGeneration += 1;
    if (deviceMotionRegistered) {
        window.removeEventListener('devicemotion', handleShake);
        deviceMotionRegistered = false;
    }
    lastX = 0;
    lastY = 0;
    lastZ = 0;
    shakeLastTime = 0;
    isBlindBoxLoading = false;
    window.currentBlindBoxMoment = null;
}

function handleShake(event) {
    if (!isAuthenticated()) return;
    const acceleration = event.accelerationIncludingGravity || event.acceleration;
    if (!acceleration) return;

    const x = Number(acceleration.x) || 0;
    const y = Number(acceleration.y) || 0;
    const z = Number(acceleration.z) || 0;
    if (lastX === 0 && lastY === 0 && lastZ === 0) {
        lastX = x;
        lastY = y;
        lastZ = z;
        return;
    }

    const delta = Math.abs(x - lastX) + Math.abs(y - lastY) + Math.abs(z - lastZ);
    lastX = x;
    lastY = y;
    lastZ = z;
    const now = Date.now();
    if (delta <= 20 || now - shakeLastTime < 2500) return;

    shakeLastTime = now;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate([25, 40, 25]); } catch (_e) {}
    }
    if (typeof isAppRouteActive === 'function' && isAppRouteActive('blindbox')) {
        fetchRandomMoment();
    } else if (typeof appNavigate === 'function') {
        appNavigate('/memories/blind-box');
    }
}

async function fetchRandomByTypes(types = null) {
    let countQuery = supabaseClient
        .from('moments')
        .select('id', { count: 'exact', head: true });
    if (types?.length) countQuery = countQuery.in('type', types);
    const { count, error: countError } = await countQuery;
    if (countError) throw countError;
    if (!count) return null;

    const offset = Math.floor(Math.random() * count);
    let itemQuery = supabaseClient
        .from('moments')
        .select('id, author, type, content, created_at')
        .order('created_at', { ascending: true })
        .range(offset, offset);
    if (types?.length) itemQuery = itemQuery.in('type', types);
    const { data, error } = await itemQuery.maybeSingle();
    if (error) throw error;
    return data || null;
}

function appendBlindBoxMedia(container, rawUrl, className, options = {}) {
    const media = typeof createMomentMedia === 'function'
        ? createMomentMedia(rawUrl, className, options)
        : null;
    if (media) container.appendChild(media);
}

function renderBlindBoxMoment(moment) {
    const content = document.getElementById('blindBoxContent');
    if (!content) return;
    content.replaceChildren();

    if (moment.type === 'photo') {
        appendBlindBoxMedia(content, moment.content, 'blind-box-img', { lightbox: true });
    } else if (moment.type === 'audio') {
        const audio = typeof createMomentAudio === 'function' ? createMomentAudio(moment.content) : null;
        if (audio) content.appendChild(audio);
    } else if (moment.type === 'moment') {
        try {
            const parsed = JSON.parse(moment.content);
            if (typeof parsed.text === 'string' && parsed.text.trim()) {
                const text = document.createElement('div');
                text.className = 'blind-box-text';
                text.textContent = parsed.text;
                content.appendChild(text);
            }
            if (parsed.audio) {
                const audio = typeof createMomentAudio === 'function' ? createMomentAudio(parsed.audio) : null;
                if (audio) content.appendChild(audio);
            }
            if (Array.isArray(parsed.images) && parsed.images.length) {
                if (parsed.images.length === 1) {
                    const video = typeof isVideoMediaUrl === 'function' && isVideoMediaUrl(sanitizeMediaUrl(parsed.images[0]));
                    appendBlindBoxMedia(content, parsed.images[0], 'blind-box-img', {
                        controls: video,
                        lightbox: !video
                    });
                } else {
                    const grid = document.createElement('div');
                    grid.className = 'moment-grid blind-box-grid';
                    parsed.images.slice(0, 9).forEach(rawUrl => {
                        const url = sanitizeMediaUrl(rawUrl);
                        const video = typeof isVideoMediaUrl === 'function' && isVideoMediaUrl(url);
                        const media = typeof createMomentMedia === 'function'
                            ? createMomentMedia(url, 'moment-grid-item', { autoplay: video, lightbox: !video })
                            : null;
                        if (media) grid.appendChild(media);
                    });
                    if (grid.childElementCount) content.appendChild(grid);
                }
            }
        } catch (error) {
            console.error('解析盲盒图文记录失败:', error);
        }
    } else {
        const text = document.createElement('div');
        text.className = 'blind-box-text';
        text.textContent = String(moment.content || '');
        content.appendChild(text);
    }

    const createdAt = new Date(moment.created_at);
    const profile = allProfilesCache[moment.author] || {};
    const meta = document.createElement('div');
    meta.className = 'blind-box-meta';
    const dateText = Number.isNaN(createdAt.getTime())
        ? ''
        : createdAt.toLocaleString('zh-CN', { hour12: false });
    meta.textContent = `${dateText} · 来自 ${profile.nickname || moment.author || '成员'}`;

    const prompt = document.createElement('div');
    prompt.className = 'blind-box-prompt';
    prompt.textContent = '✨ 还记得这一天吗？';

    const locateButton = document.createElement('button');
    locateButton.type = 'button';
    locateButton.className = 'btn-cancel blind-box-locate';
    locateButton.textContent = '📍 定位到原文';
    locateButton.addEventListener('click', locateToMoment);
    content.append(meta, prompt, locateButton);
}

async function fetchRandomMoment() {
    if (isBlindBoxLoading || !isAuthenticated()) return;
    isBlindBoxLoading = true;
    setBlindBoxMessage('✨ 魔法生效中，正在抽取回忆...');

    const epoch = authEpoch;
    const userId = currentAuthUser.id;
    const generation = blindBoxGeneration;
    try {
        const random = Math.random();
        const preferredTypes = random < 0.7
            ? ['photo', 'moment']
            : (random < 0.9 ? ['text'] : ['audio']);
        const rawMoment = await fetchRandomByTypes(preferredTypes) || await fetchRandomByTypes();
        const moment = rawMoment && typeof hydrateMomentMediaRecord === 'function'
            ? await hydrateMomentMediaRecord(rawMoment)
            : rawMoment;
        if (!isBlindBoxSnapshotCurrent(epoch, userId, generation)) return;
        if (!moment) {
            setBlindBoxMessage('回忆库空空如也，快去多记录一些吧！');
            return;
        }

        window.currentBlindBoxMoment = moment;
        renderBlindBoxMoment(moment);
    } catch (error) {
        if (isBlindBoxSnapshotCurrent(epoch, userId, generation)) setBlindBoxMessage('抽取失败了，请稍后再试一次…');
        console.error('抽取盲盒回忆失败:', error);
    } finally {
        if (generation === blindBoxGeneration) isBlindBoxLoading = false;
    }
}

function locateToMoment() {
    const moment = window.currentBlindBoxMoment;
    const content = document.getElementById('timeline-content');
    if (!isAuthenticated() || !content || !moment) return;
    if (typeof appReplace === 'function') appReplace('/', { force: true });
    else window.location.hash = '#/';

    const backWrap = document.createElement('div');
    backWrap.className = 'blind-box-back';
    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.textContent = '🔙 返回全部回忆';
    backButton.addEventListener('click', () => fetchMoments());
    backWrap.appendChild(backButton);

    const card = typeof createMomentCardElement === 'function' ? createMomentCardElement(moment) : null;
    content.replaceChildren(backWrap);
    if (card) content.appendChild(card);
    hasMore = false;

    if (typeof initScrollReveal === 'function') initScrollReveal();
    if (typeof loadCommentCounts === 'function') loadCommentCounts([moment.id]);
    if (typeof loadMomentLikes === 'function') loadMomentLikes([moment.id]);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('blind-box-target');
    setTimeout(() => card?.classList.remove('blind-box-target'), 2500);
}
