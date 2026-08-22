// --- 发布图文动态 ---
let momentSelectedFiles = [];
let momentAudioBlob = null;
let momentMediaRecorder = null;
let momentMediaStream = null;
let momentAudioChunks = [];
let momentRecordingStartTime = 0;
let momentRecordingSessionId = 0;
let momentRecordingShouldDiscard = false;
let isMomentRecording = false;
let momentAudioPreviewUrl = null;
const momentPhotoPreviewUrls = new Set();
let isMomentSubmitting = false;
let editingMomentId = null;
let editingExistingMedia = []; // Array of { ref: string, url: string, isVideo: boolean }
let editingAudioRef = null;
let editingAudioUrl = null;
const MAX_MOMENT_MEDIA_BYTES = 100 * 1024 * 1024;
function isAllowedMomentMedia(file) {
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) return true;
    const ext = String(file.name).split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'].includes(ext);
}

function hasMomentAuthContext() {
    return typeof hasAuthContext === 'function' ? hasAuthContext() : Boolean(currentAuthUser && currentAuthor);
}

function getMomentAuthEpoch() {
    return typeof getAuthEpoch === 'function' ? getAuthEpoch() : (typeof authEpoch === 'number' ? authEpoch : 0);
}

function isMomentAuthEpochCurrent(epoch) {
    return typeof isCurrentAuthSnapshot === 'function' && currentAuthUser
        ? isCurrentAuthSnapshot(epoch, currentAuthUser.id)
        : (hasMomentAuthContext() && getMomentAuthEpoch() === epoch);
}


function getMomentProfileAvatarUrl(profile) {
    if (typeof getProfileAvatarUrl === 'function') return getProfileAvatarUrl(profile);
    return sanitizeMediaUrl(profile && profile.avatar_url);
}

function getMomentStorageDirectory() {
    const spaceId = currentUserProfile && String(currentUserProfile.space_id || '');
    const userId = currentAuthUser && String(currentAuthUser.id || '');
    const isSafeSegment = value => /^[A-Za-z0-9_-]+$/.test(value);
    if (!isSafeSegment(spaceId) || !isSafeSegment(userId)) return '';
    return `${spaceId}/${userId}/moments`;
}

function getMomentFileExtension(file) {
    const nameExtension = String(file && file.name || '').split('.').pop().toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(nameExtension)) return nameExtension;
    const typeExtension = String(file && file.type || '').split('/').pop().split(';')[0].toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(typeExtension) ? typeExtension : 'bin';
}

async function removeUploadedMomentObjects(paths) {
    if (!paths.length) return;
    const { error } = await supabaseClient.storage.from('photos').remove(paths);
    if (error) console.error('清理未完成的动态媒体失败:', error);
}

function revokeMomentObjectUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    momentPhotoPreviewUrls.delete(url);
}

function clearMomentPhotoPreviews() {
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    if (previewContainer) releaseMomentVideosWithin(previewContainer, true);
    momentPhotoPreviewUrls.forEach(url => URL.revokeObjectURL(url));
    momentPhotoPreviewUrls.clear();
    momentSelectedFiles = [];
    editingExistingMedia = [];

    if (!previewContainer) return;
    previewContainer.querySelectorAll('.moment-preview-item').forEach(item => item.remove());
}

function clearMomentAudioPreview() {
    if (momentAudioPreviewUrl) {
        URL.revokeObjectURL(momentAudioPreviewUrl);
        momentAudioPreviewUrl = null;
    }
    const player = document.getElementById('momentAudioPlayer');
    if (player) {
        player.pause();
        player.removeAttribute('src');
        player.load();
    }
}

function stopMomentMediaStream() {
    if (momentMediaStream) {
        momentMediaStream.getTracks().forEach(track => track.stop());
        momentMediaStream = null;
    }
}

function cancelMomentRecording() {
    momentRecordingSessionId += 1;
    momentRecordingShouldDiscard = true;
    isMomentRecording = false;
    if (momentMediaRecorder && momentMediaRecorder.state !== 'inactive') {
        try {
            momentMediaRecorder.stop();
        } catch (error) {
            console.warn('停止录音失败:', error);
        }
    }
    stopMomentMediaStream();
    momentMediaRecorder = null;
    momentAudioChunks = [];
    resetMomentAudioBtn();
}

function resetMomentComposer(options = {}) {
    const { clearPhotos = true, clearAudio = true, clearText = true } = options;
    cancelMomentRecording();
    editingMomentId = null;
    editingExistingMedia = [];
    editingAudioRef = null;
    editingAudioUrl = null;

    if (clearPhotos) clearMomentPhotoPreviews();
    if (clearAudio) {
        momentAudioBlob = null;
        clearMomentAudioPreview();
    }

    const previewAudio = document.getElementById('momentAudioPreview');
    const btnAudio = document.getElementById('btn-moment-audio');
    if (previewAudio) previewAudio.style.display = 'none';
    if (btnAudio) btnAudio.style.display = 'flex';
    if (clearText) {
        const textInput = document.getElementById('momentTextInput');
        if (textInput) {
            textInput.value = '';
            textInput.disabled = false;
        }
        const milestone = document.getElementById('momentIsMilestone');
        if (milestone) milestone.checked = false;
        const message = document.getElementById('momentModalMsg');
        if (message) message.textContent = '';
        const title = document.getElementById('moment-modal-title');
        if (title) title.textContent = '记录此刻';
        const submitBtn = document.getElementById('btn-submit-moment');
        if (submitBtn) submitBtn.textContent = '发布';
    }
}

function bindMomentModalLifecycle() {
    const page = document.getElementById('momentModal');
    if (!page || page.dataset.lifecycleBound === 'true') return;
    page.dataset.lifecycleBound = 'true';
    window.addEventListener('pagehide', () => resetMomentComposer());
}

function openMomentModal(options = {}) {
    if (options?.editId) {
        openMomentEditModal(options.editId);
        return;
    }
    const milestone = options?.milestone === true;
    const target = milestone ? '/moments/new?milestone=1' : '/moments/new';
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

function openMomentEditModal(momentId) {
    const id = normalizeMomentId(momentId);
    if (!id) return;
    const target = `/moments/edit/${encodeURIComponent(String(id))}`;
    if (typeof appNavigate === 'function') {
        appNavigate(target);
        return;
    }
    window.location.hash = `#${target}`;
}

function renderExistingMediaPreviews(existingList) {
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    if (!previewContainer || !Array.isArray(existingList)) return;
    const addBtn = previewContainer.querySelector('.moment-image-add-btn');

    existingList.forEach(item => {
        const previewItem = document.createElement('div');
        previewItem.className = 'moment-preview-item';
        let media;
        if (item.isVideo) {
            media = document.createElement('video');
            media.muted = true;
            media.loop = true;
            media.playsInline = true;
            media.preload = 'none';
            Object.assign(media.style, { width: '100%', height: '100%', objectFit: 'cover' });
        } else {
            media = document.createElement('img');
            media.alt = '预览';
        }
        media.src = item.url;
        if (media.tagName === 'VIDEO') setupMomentVideoPlayback(media, true);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', '移除此媒体');
        Object.assign(removeBtn.style, { border: '0', padding: '0' });
        removeBtn.addEventListener('click', () => {
            const index = editingExistingMedia.indexOf(item);
            if (index >= 0) editingExistingMedia.splice(index, 1);
            if (media.tagName === 'VIDEO') releaseMomentVideo(media, true);
            previewItem.remove();
        });

        previewItem.append(media, removeBtn);
        previewContainer.insertBefore(previewItem, addBtn);
        if (media.tagName === 'VIDEO') refreshMomentVideoPlayback(media);
    });
}

async function enterMomentPage(route) {
    const page = document.getElementById('momentModal');
    const input = document.getElementById('momentTextInput');
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    if (!page || !input || !previewContainer || !hasMomentAuthContext()) return;
    bindMomentModalLifecycle();
    resetMomentComposer();

    const requestAuthEpoch = getMomentAuthEpoch();
    const editId = route?.params?.id ? normalizeMomentId(route.params.id) : null;

    const titleEl = document.getElementById('moment-modal-title') || page.querySelector('.modal-title');
    const submitBtn = document.getElementById('btn-submit-moment');
    const msgEl = document.getElementById('momentModalMsg');
    const milestoneCheckbox = document.getElementById('momentIsMilestone');

    const p = allProfilesCache[currentAuthor] || {};
    if (titleEl) {
        titleEl.replaceChildren();
        const avatarUrl = getMomentProfileAvatarUrl(p);
        if (avatarUrl) {
            const avatar = document.createElement('img');
            avatar.src = avatarUrl;
            avatar.alt = '';
            Object.assign(avatar.style, {
                width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover',
                verticalAlign: 'middle', marginRight: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.2)'
            });
            titleEl.appendChild(avatar);
        }
        titleEl.appendChild(document.createTextNode(editId ? '✏️ 编辑动态' : '✨ 发布动态'));
    }

    if (msgEl) msgEl.textContent = '';
    if (submitBtn) submitBtn.textContent = editId ? '保存修改' : '发布';

    // 重置录音状态与预览
    const btnAudio = document.getElementById('btn-moment-audio');
    const previewAudio = document.getElementById('momentAudioPreview');
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

    if (!editId) {
        input.value = '';
        if (milestoneCheckbox) milestoneCheckbox.checked = route?.query?.milestone === '1';
        setTimeout(() => input.focus(), 100);
        return;
    }

    // 编辑模式：拉取动态记录并回显
    editingMomentId = editId;
    input.disabled = true;
    if (msgEl) msgEl.textContent = '正在加载动态详情…';

    try {
        const { data, error } = await supabaseClient
            .from('moments')
            .select('*')
            .eq('id', editId)
            .maybeSingle();

        if (!isMomentAuthEpochCurrent(requestAuthEpoch)) return;
        if (error || !data) {
            console.error('加载待编辑动态失败:', error);
            if (typeof showToast === 'function') showToast('无法读取该动态，可能已被删除。');
            closeMomentModal(true);
            return;
        }

        let rawText = '';
        let rawImages = [];
        let rawAudio = null;
        let isMilestone = false;

        if (data.type === 'moment') {
            try {
                const parsed = JSON.parse(data.content);
                if (parsed && typeof parsed === 'object') {
                    rawText = typeof parsed.text === 'string' ? parsed.text : '';
                    rawImages = Array.isArray(parsed.images) ? parsed.images : [];
                    rawAudio = parsed.audio || null;
                    isMilestone = parsed.is_milestone === true;
                }
            } catch (e) {
                rawText = data.content || '';
            }
        } else if (data.type === 'text') {
            rawText = data.content || '';
        } else if (data.type === 'photo') {
            rawImages = data.content ? [data.content] : [];
        } else if (data.type === 'audio') {
            rawAudio = data.content || null;
        }

        input.value = rawText;
        if (milestoneCheckbox) milestoneCheckbox.checked = isMilestone;
        if (msgEl) msgEl.textContent = '';

        if (rawImages.length > 0) {
            let resolvedImages = [];
            try {
                resolvedImages = typeof batchResolveMediaUrls === 'function'
                    ? await batchResolveMediaUrls(rawImages)
                    : [];
            } catch (e) {
                console.warn('批量解析媒体地址失败:', e);
            }

            if (!isMomentAuthEpochCurrent(requestAuthEpoch)) return;

            editingExistingMedia = await Promise.all(rawImages.map(async (ref, i) => {
                let resolved = (resolvedImages && resolvedImages[i]) || '';
                if (!resolved && typeof resolveMediaUrl === 'function') {
                    try {
                        resolved = await resolveMediaUrl(ref);
                    } catch (_err) {}
                }
                if (!resolved) {
                    resolved = sanitizeMediaUrl(ref);
                }
                return {
                    ref: ref,
                    url: resolved,
                    isVideo: isVideoMediaUrl(ref) || (resolved ? isVideoMediaUrl(resolved) : false)
                };
            }));

            renderExistingMediaPreviews(editingExistingMedia);
        }

        if (rawAudio) {
            const resolvedAudio = typeof resolveMediaUrl === 'function'
                ? await resolveMediaUrl(rawAudio)
                : sanitizeMediaUrl(rawAudio);

            if (!isMomentAuthEpochCurrent(requestAuthEpoch)) return;

            if (resolvedAudio) {
                editingAudioRef = rawAudio;
                editingAudioUrl = resolvedAudio;
                const player = document.getElementById('momentAudioPlayer');
                if (player) {
                    player.src = resolvedAudio;
                    player.load();
                }
                if (previewAudio) previewAudio.style.display = 'flex';
                if (btnAudio) btnAudio.style.display = 'none';
            }
        }
    } catch (err) {
        console.error('加载待编辑动态异常:', err);
        if (isMomentAuthEpochCurrent(requestAuthEpoch)) {
            if (typeof showToast === 'function') showToast('加载动态失败，请稍后重试。');
            closeMomentModal(true);
        }
    } finally {
        if (isMomentAuthEpochCurrent(requestAuthEpoch)) {
            input.disabled = false;
            setTimeout(() => input.focus(), 100);
        }
    }
}

function closeMomentModal(force = false) {
    if (isMomentSubmitting && !force) {
        const message = document.getElementById('momentModalMsg');
        if (message) message.textContent = editingMomentId ? '正在保存，请稍候…' : '正在发布，请稍候…';
        return;
    }
    if (typeof appBack === 'function') {
        appBack('/', { force });
        return;
    }
    resetMomentComposer();
    window.location.hash = '#/';
}

function leaveMomentPage() {
    resetMomentComposer();
}

function handleMomentPhotoSelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    const previewContainer = document.getElementById('momentImagePreviewContainer');
    if (!previewContainer) return;
    const addBtn = previewContainer.querySelector('.moment-image-add-btn');
    const validFiles = files.filter(file => isAllowedMomentMedia(file) && file.size <= MAX_MOMENT_MEDIA_BYTES);
    if (validFiles.length !== files.length) {
        const msgEl = document.getElementById('momentModalMsg');
        if (msgEl) msgEl.textContent = '单个文件不超过 100MB，仅支持常见图文或视频。';
    }
    validFiles.forEach(file => {
        momentSelectedFiles.push(file);
        const objectUrl = URL.createObjectURL(file);
        momentPhotoPreviewUrls.add(objectUrl);
        const previewItem = document.createElement('div');
        previewItem.className = 'moment-preview-item';
        let media;
        if (file.type.startsWith('video/')) {
            media = document.createElement('video');
            media.muted = true;
            media.loop = true;
            media.playsInline = true;
            media.preload = 'none';
            Object.assign(media.style, { width: '100%', height: '100%', objectFit: 'cover' });
        } else {
            media = document.createElement('img');
            media.alt = '预览';
        }
        media.src = objectUrl;
        if (media.tagName === 'VIDEO') setupMomentVideoPlayback(media, true);
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-btn';
        removeBtn.textContent = '×';
        removeBtn.setAttribute('aria-label', `移除 ${file.name}`);
        Object.assign(removeBtn.style, { border: '0', padding: '0' });
        removeBtn.addEventListener('click', () => {
            const fileIndex = momentSelectedFiles.indexOf(file);
            if (fileIndex >= 0) momentSelectedFiles.splice(fileIndex, 1);
            if (media.tagName === 'VIDEO') releaseMomentVideo(media, true);
            revokeMomentObjectUrl(objectUrl);
            previewItem.remove();
        });
        previewItem.append(media, removeBtn);
        previewContainer.insertBefore(previewItem, addBtn);
        if (media.tagName === 'VIDEO') refreshMomentVideoPlayback(media);
    });
    
    // 清空 input 使得重复选择相同文件能触发 change
    document.getElementById('momentPhotoInput').value = '';
}

// --- 图像与视频压缩功能 ---
let ffmpegInstance = null;

/**
 * 客户端高保真智能图片压缩：
 * 1. 优先输出高效现代 WebP 格式（质量 0.80），体积相比 JPEG 减小 40%~60%，极大加速上传和首屏下载。
 * 2. 如浏览器不支持 WebP 导出，平滑降级为 JPEG。
 * 3. 动图（GIF）自动跳过压缩，保护完整帧动效。
 * 4. 2K 超清分辨率自适应（最大边长 1920px，完美适配 Retina 视网膜屏与桌面端）。
 */
async function compressImageFile(file, maxWidth = 1920, maxHeight = 1920, quality = 0.80) {
    if (!file || !file.type.startsWith('image/')) return file;
    // GIF 动图不进行有损压缩
    if (file.type === 'image/gif' || (typeof file.name === 'string' && file.name.toLowerCase().endsWith('.gif'))) {
        return file;
    }
    // 已经很小的 WebP/JPEG 小图直接放行
    if (file.size <= 150 * 1024 && (file.type === 'image/webp' || file.type === 'image/jpeg')) {
        return file;
    }

    try {
        const image = await new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('IMAGE_DECODE_FAILED'));
            };
            img.src = url;
        });

        let { naturalWidth: width, naturalHeight: height } = image;
        if (!width || !height) return file;

        // 计算等比缩放
        if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.max(1, Math.round(width * ratio));
            height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return file;

        // 透明通道保护：PNG 保持透明，其他填充白底防黑边
        const isPng = file.type === 'image/png';
        if (!isPng) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
        }

        ctx.drawImage(image, 0, 0, width, height);

        // 优先尝试 WebP，如浏览器不支持则回退为 JPEG/PNG
        let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        let targetMime = 'image/webp';
        let ext = 'webp';

        if (!blob || blob.type !== 'image/webp') {
            targetMime = isPng ? 'image/png' : 'image/jpeg';
            ext = isPng ? 'png' : 'jpg';
            blob = await new Promise(resolve => canvas.toBlob(resolve, targetMime, quality));
        }

        if (!blob || (blob.size >= file.size && file.type === targetMime)) {
            return file;
        }

        const baseName = (file.name || 'photo').replace(/\.[^/.]+$/, '');
        return new File([blob], `${baseName}.${ext}`, { type: targetMime });
    } catch (err) {
        console.warn('图片前端压缩处理失败，降级使用原图:', err);
        return file;
    }
}

async function getFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;

    const loadWithTimeout = (promise, ms, name) => {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} 加载超时`)), ms))
        ]);
    };

    await loadWithTimeout(new Promise((resolve, reject) => {
        if (window.FFmpegWASM) return resolve();
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    }), 12000, 'FFmpeg-WASM-JS');

    await loadWithTimeout(new Promise((resolve, reject) => {
        if (window.FFmpegUtil) return resolve();
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    }), 12000, 'FFmpeg-Util-JS');

    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();
    await loadWithTimeout(ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm'
    }), 15000, 'FFmpeg-Core-WASM');

    ffmpegInstance = ffmpeg;
    return ffmpeg;
}


function isMomentVideoFile(file) {
    if (file.type.startsWith('video/')) return true;
    const ext = String(file.name).split('.').pop().toLowerCase();
    return ['mp4', 'webm', 'mov', 'm4v', 'quicktime'].includes(ext);
}

async function compressVideoFile(file, onProgress) {
    try {
        const ffmpeg = await getFFmpeg();
        const { fetchFile } = window.FFmpegUtil;

        ffmpeg.on('progress', ({ progress }) => {
            if (onProgress) onProgress(Math.round(progress * 100));
        });

        const inputExt = getMomentFileExtension(file) || 'mp4';
        const inputName = 'input.' + (inputExt === 'bin' ? 'mp4' : inputExt);
        const outputName = 'output.mp4';

        await ffmpeg.writeFile(inputName, await fetchFile(file));

        await ffmpeg.exec([
            '-i', inputName,
            '-vcodec', 'libx264',
            '-crf', '28',
            '-preset', 'ultrafast',
            outputName
        ]);

        const data = await ffmpeg.readFile(outputName);
        const newBlob = new Blob([data.buffer], { type: 'video/mp4' });

        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
        ffmpeg.off('progress');

        return new File([newBlob], file.name.replace(/\.[^/.]+$/, "") + "_compressed.mp4", {
            type: 'video/mp4'
        });
    } catch (e) {
        console.error("Video compression failed", e);
        if (ffmpegInstance) ffmpegInstance.off('progress');
        return file;
    }
}

async function submitMomentPost() {
    if (!hasMomentAuthContext() || isMomentSubmitting) return;
    const requestAuthEpoch = getMomentAuthEpoch();
    const text = document.getElementById('momentTextInput').value.trim();
    const msgEl = document.getElementById('momentModalMsg');
    const isEditing = Boolean(editingMomentId);
    
    const hasText = Boolean(text);
    const hasNewFiles = momentSelectedFiles.length > 0;
    const hasExistingMedia = editingExistingMedia.length > 0;
    const hasNewAudio = Boolean(momentAudioBlob);
    const hasExistingAudio = Boolean(editingAudioRef);

    if (!hasText && !hasNewFiles && !hasExistingMedia && !hasNewAudio && !hasExistingAudio) {
        msgEl.innerText = '写点什么、发张照片或录段声音吧！';
        return;
    }

    if (momentSelectedFiles.some(file => !isAllowedMomentMedia(file) || file.size > MAX_MOMENT_MEDIA_BYTES)
        || (momentAudioBlob && momentAudioBlob.size > MAX_MOMENT_MEDIA_BYTES)) {
        msgEl.textContent = '媒体格式或大小不符合要求，请重新选择。';
        return;
    }

    const storageDirectory = getMomentStorageDirectory();
    if (!storageDirectory || typeof createStorageReference !== 'function') {
        msgEl.innerText = '当前会话缺少空间信息，请重新登录后再试。';
        return;
    }

    const btn = document.getElementById('btn-submit-moment');
    const orig = btn.textContent;
    isMomentSubmitting = true;
    btn.disabled = true;
    const uploadedObjectPaths = [];
    let databaseCommitted = false;

    try {
        let uploadedUrls = [];
        if (momentSelectedFiles.length > 0) {
            const totalFiles = momentSelectedFiles.length;
            const processedFiles = [];

            // 第一阶段：客户端智能优化（超清压缩图片，压缩过大视频）
            for (let i = 0; i < totalFiles; i++) {
                let file = momentSelectedFiles[i];
                if (isMomentVideoFile(file) && file.size > 20 * 1024 * 1024) {
                    btn.textContent = `⏳ 准备压缩视频 (${i + 1}/${totalFiles})...`;
                    file = await compressVideoFile(file, (progress) => {
                        btn.textContent = `⏳ 压缩视频 ${progress}% (${i + 1}/${totalFiles})...`;
                    });
                } else if (file.type.startsWith('image/')) {
                    btn.textContent = `⏳ 正在优化画质 (${i + 1}/${totalFiles})...`;
                    file = await compressImageFile(file);
                }
                processedFiles.push(file);
            }

            // 第二阶段：并行极速上传
            btn.textContent = '⏳ 正在极速上传…';
            const uploadTasks = processedFiles.map(async (file, index) => {
                const fileExt = getMomentFileExtension(file);
                const fileName = `${storageDirectory}/${Date.now()}_${index}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
                const { error } = await supabaseClient.storage
                    .from('photos')
                    .upload(fileName, file, { contentType: file.type || 'application/octet-stream', upsert: false });
                if (error) throw error;
                return {
                    path: fileName,
                    ref: createStorageReference(fileName)
                };
            });

            const uploadResults = await Promise.all(uploadTasks);
            uploadResults.forEach(res => {
                uploadedObjectPaths.push(res.path);
                uploadedUrls.push(res.ref);
            });
        }

        btn.textContent = isEditing ? '⏳ 正在保存修改…' : '⏳ 正在保存记录…';
        let audioUrl = null;
        if (momentAudioBlob) {
            const audioType = momentAudioBlob.type || 'audio/webm';
            const audioMime = audioType.split(';', 1)[0].trim().toLowerCase() || 'audio/webm';
            const audioExtension = audioMime.includes('ogg') ? 'ogg' : (audioMime.includes('mp4') ? 'm4a' : 'webm');
            const fileName = `${storageDirectory}/audio_${Date.now()}_${Math.random().toString(36).substring(2,9)}.${audioExtension}`;
            const { error: audioUploadError } = await supabaseClient.storage.from('photos').upload(fileName, momentAudioBlob, { contentType: audioMime, upsert: false });
            if (audioUploadError) throw audioUploadError;
            uploadedObjectPaths.push(fileName);
            audioUrl = createStorageReference(fileName);
        }

        if (!isMomentAuthEpochCurrent(requestAuthEpoch)) throw new Error('AUTH_CONTEXT_CHANGED');

        const chkIsMilestone = document.getElementById('momentIsMilestone');
        const isMilestone = chkIsMilestone ? chkIsMilestone.checked : false;

        const retainedImages = editingExistingMedia.map(item => item.ref).filter(Boolean);
        const finalImages = [...retainedImages, ...uploadedUrls];
        const finalAudio = audioUrl || editingAudioRef || null;

        const momentPayload = {
            text: text,
            images: finalImages,
            audio: finalAudio,
            is_milestone: isMilestone
        };
        if (isEditing) {
            momentPayload.updated_at = new Date().toISOString();
        }

        const momentContent = JSON.stringify(momentPayload);

        if (isEditing) {
            let updateSuccess = false;
            let lastError = null;

            // 优先尝试原子化 RPC 更新（通过标准 HTTP POST，无 CORS 限制，安全性最高）
            try {
                const { data: rpcSuccess, error: rpcError } = await supabaseClient.rpc('update_moment', {
                    p_moment_id: editingMomentId,
                    p_content: momentContent
                });
                if (!rpcError && rpcSuccess === true) {
                    updateSuccess = true;
                } else if (rpcError) {
                    lastError = rpcError;
                    console.warn('RPC update_moment 未成功，尝试直接表更新:', rpcError);
                }
            } catch (rpcEx) {
                lastError = rpcEx;
                console.warn('RPC update_moment 异常，尝试直接表更新:', rpcEx);
            }

            // 降级尝试直接 UPDATE (HTTP PATCH)
            if (!updateSuccess) {
                const { error: directError } = await supabaseClient
                    .from('moments')
                    .update({ type: 'moment', content: momentContent })
                    .eq('id', editingMomentId);
                if (directError) {
                    throw directError || lastError;
                }
            }
        } else {
            const { error: dbError } = await supabaseClient
                .from('moments')
                .insert([{ type: 'moment', content: momentContent }]);
            if (dbError) throw dbError;
        }
        
        databaseCommitted = true;
        if (!isMomentAuthEpochCurrent(requestAuthEpoch)) return;
        
        closeMomentModal(true);
        fetchMoments();
        if (typeof renderMilestonesContent === 'function') {
            renderMilestonesContent();
        }
        if (typeof showToast === 'function') {
            showToast(isEditing ? '动态已修改 ✨' : '动态已发布 ✨');
        }
    } catch (err) {
        if (!databaseCommitted) await removeUploadedMomentObjects(uploadedObjectPaths);
        console.error(isEditing ? '保存修改失败:' : '发布动态失败:', err);
        if (isMomentAuthEpochCurrent(requestAuthEpoch)) {
            const errorMsg = String(err?.message || err || '');
            if (errorMsg.includes('policy') || errorMsg.includes('permission') || err?.code === '42501') {
                msgEl.textContent = '保存失败：数据库尚未开启动态更新权限，请在 Supabase SQL Editor 中执行迁移脚本。';
            } else {
                msgEl.textContent = isEditing ? `保存失败：${errorMsg || '请检查网络或稍后重试。'}` : '发布失败，请检查网络或稍后重试。';
            }
        }
    } finally {
        isMomentSubmitting = false;
        btn.textContent = orig;
        btn.disabled = false;
    }
}

// --- 录音功能（发布动态弹窗内部整合） ---
async function toggleMomentRecording() {
    if (!hasMomentAuthContext()) return;
    if (isMomentRecording) {
        // 停止录音
        if (momentMediaRecorder && momentMediaRecorder.state !== 'inactive') {
            momentRecordingShouldDiscard = false;
            momentMediaRecorder.stop();
        }
        isMomentRecording = false;
        return;
    }

    // 开始录音
    executeMomentRecording();
}

async function executeMomentRecording() {
    const sessionId = ++momentRecordingSessionId;
    momentRecordingShouldDiscard = false;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const isComposerActive = typeof isAppRouteActive === 'function'
            ? isAppRouteActive('moment')
            : document.getElementById('momentModal')?.classList.contains('is-active');
        if (sessionId !== momentRecordingSessionId || !isComposerActive || !hasMomentAuthContext()) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        momentMediaStream = stream;
        const recorder = new MediaRecorder(stream);
        const chunks = [];
        const recorderMimeType = recorder.mimeType || 'audio/webm';
        const recordingStartedAt = Date.now();
        momentMediaRecorder = recorder;
        momentAudioChunks = chunks;

        recorder.ondataavailable = event => {
            if (event.data.size > 0) chunks.push(event.data);
        };

        recorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            const isCurrentRecorder = sessionId === momentRecordingSessionId
                && momentMediaRecorder === recorder;
            if (!isCurrentRecorder) return;

            const duration = Date.now() - recordingStartedAt;
            if (momentMediaStream === stream) momentMediaStream = null;
            isMomentRecording = false;
            momentMediaRecorder = null;
            if (momentRecordingShouldDiscard) {
                momentAudioChunks = [];
                resetMomentAudioBtn();
                return;
            }
            
            const btn = document.getElementById('btn-moment-audio');
            if (duration < 1000) {
                alert('录音时间太短啦，至少要1秒哦！');
                momentAudioChunks = [];
                resetMomentAudioBtn();
                return;
            }

            momentAudioBlob = new Blob(chunks, { type: recorderMimeType });
            momentAudioChunks = [];
            
            // 展示预览播放器，隐藏录制按钮
            const previewEl = document.getElementById('momentAudioPreview');
            const playerEl = document.getElementById('momentAudioPlayer');
            if (playerEl) {
                clearMomentAudioPreview();
                momentAudioPreviewUrl = URL.createObjectURL(momentAudioBlob);
                playerEl.src = momentAudioPreviewUrl;
            }
            if (previewEl) {
                previewEl.style.display = 'flex';
            }
            if (btn) {
                btn.style.display = 'none';
            }
            resetMomentAudioBtn();
        };

        recorder.start();
        isMomentRecording = true;
        momentRecordingStartTime = recordingStartedAt;
        
        const btn = document.getElementById('btn-moment-audio');
        if (btn) {
            const txt = btn.querySelector('.audio-text');
            if (txt) txt.innerText = '正在录音... 点击结束';
            const icon = btn.querySelector('.audio-icon');
            if (icon) icon.innerText = '🔴';
            btn.classList.add('recording-active');
            btn.setAttribute('aria-pressed', 'true');
        }
    } catch (err) {
        if (sessionId !== momentRecordingSessionId) return;
        alert('无法访问麦克风，请检查设备权限设置！\n' + err.message);
        isMomentRecording = false;
        stopMomentMediaStream();
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
        btn.setAttribute('aria-pressed', 'false');
    }
}

function deleteRecordedAudio() {
    cancelMomentRecording();
    momentAudioBlob = null;
    editingAudioRef = null;
    editingAudioUrl = null;
    const previewEl = document.getElementById('momentAudioPreview');
    const playerEl = document.getElementById('momentAudioPlayer');
    const btn = document.getElementById('btn-moment-audio');
    
    clearMomentAudioPreview();
    if (previewEl) previewEl.style.display = 'none';
    if (btn) btn.style.display = 'flex';
}
// --- 时光轴（无限滚动） ---
let scrollObserver = null;
let momentTimelineCursor = null;
const renderedMomentIds = new Set();
const managedMomentVideos = new Set();
let momentVideoObserver = null;
const momentVideoMotionPreference = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

function isMomentVideoDisplayed(video) {
    if (!video?.isConnected || video.hidden) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(video);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function isMomentVideoInViewport(video) {
    const rect = video.getBoundingClientRect();
    return rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth;
}

function updateMomentVideoPlayback(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    const isAutoVideo = video.dataset.momentAutoplay === 'true';
    const canPlay = document.visibilityState !== 'hidden'
        && video.dataset.momentIntersecting === 'true'
        && isMomentVideoDisplayed(video);
    const reduceMotion = momentVideoMotionPreference?.matches === true;

    if (!canPlay || (isAutoVideo && reduceMotion)) {
        if (!video.paused) video.pause();
        return;
    }

    if (isAutoVideo && video.paused) {
        const playRequest = video.play();
        if (playRequest && typeof playRequest.catch === 'function') {
            playRequest.catch(() => {});
        }
    }
}

function ensureMomentVideoObserver() {
    if (momentVideoObserver || typeof IntersectionObserver !== 'function') return;
    momentVideoObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            const video = entry.target;
            video.dataset.momentIntersecting = entry.isIntersecting ? 'true' : 'false';
            updateMomentVideoPlayback(video);
        });
    }, { threshold: 0.01 });
}

function refreshMomentVideoPlayback(video) {
    if (!(video instanceof HTMLVideoElement)) return;
    video.dataset.momentIntersecting = isMomentVideoDisplayed(video) && isMomentVideoInViewport(video)
        ? 'true'
        : 'false';
    updateMomentVideoPlayback(video);
}

function setupMomentVideoPlayback(video, autoplay = false) {
    if (!(video instanceof HTMLVideoElement)) return;
    video.autoplay = false;
    video.removeAttribute('autoplay');
    video.dataset.momentAutoplay = autoplay ? 'true' : 'false';
    video.dataset.momentIntersecting = 'false';
    managedMomentVideos.add(video);
    ensureMomentVideoObserver();
    if (momentVideoObserver) {
        momentVideoObserver.observe(video);
    } else {
        refreshMomentVideoPlayback(video);
    }
}

function releaseMomentVideo(video, unload = false) {
    if (!(video instanceof HTMLVideoElement)) return;
    video.pause();
    if (momentVideoObserver) momentVideoObserver.unobserve(video);
    managedMomentVideos.delete(video);
    delete video.dataset.momentAutoplay;
    delete video.dataset.momentIntersecting;
    if (unload) {
        video.removeAttribute('src');
        video.load();
    }
}

function releaseMomentVideosWithin(container, unload = false) {
    if (!container) return;
    if (container instanceof HTMLVideoElement) releaseMomentVideo(container, unload);
    container.querySelectorAll?.('video').forEach(video => releaseMomentVideo(video, unload));
}

document.addEventListener('visibilitychange', () => {
    managedMomentVideos.forEach(video => {
        if (document.hidden) {
            video.pause();
        } else {
            refreshMomentVideoPlayback(video);
        }
    });
});

if (momentVideoMotionPreference) {
    const handleMomentMotionPreference = () => {
        managedMomentVideos.forEach(video => refreshMomentVideoPlayback(video));
    };
    if (typeof momentVideoMotionPreference.addEventListener === 'function') {
        momentVideoMotionPreference.addEventListener('change', handleMomentMotionPreference);
    } else if (typeof momentVideoMotionPreference.addListener === 'function') {
        momentVideoMotionPreference.addListener(handleMomentMotionPreference);
    }
}

function createMomentNode(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
}

function normalizeMomentId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isVideoMediaUrl(url) {
    try {
        const parsed = new URL(url);
        return /\.(mp4|mov|webm|ogg)$/i.test(parsed.pathname) || parsed.pathname.includes('/video');
    } catch (error) {
        return false;
    }
}

function createCardTextElement(text, momentId) {
    const safeText = typeof text === 'string' ? text : String(text || '');
    if (!safeText) return null;
    if (safeText.length <= 80) return createMomentNode('div', 'card-text', safeText);

    const container = createMomentNode('div', 'card-text-container');
    container.id = `text-container-${momentId}`;
    const collapsed = createMomentNode('div', 'card-text text-collapsed', `${safeText.slice(0, 80)}...`);
    collapsed.style.display = 'block';
    const expanded = createMomentNode('div', 'card-text text-expanded', safeText);
    expanded.style.display = 'none';
    const toggle = createMomentNode('button', 'toggle-text-btn', '展开');
    toggle.type = 'button';
    toggle.dataset.momentAction = 'toggle-text';
    toggle.dataset.momentId = String(momentId);
    container.append(collapsed, expanded, toggle);
    return container;
}

function createMomentAudio(rawUrl) {
    const url = sanitizeMediaUrl(rawUrl);
    if (!url) return null;
    const wrapper = createMomentNode('div');
    wrapper.style.marginTop = '10px';
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = url;
    Object.assign(audio.style, { width: '100%', height: '40px', borderRadius: '20px' });
    wrapper.appendChild(audio);
    return wrapper;
}

function createMomentMedia(rawUrl, className, options = {}) {
    const url = sanitizeMediaUrl(rawUrl);
    if (!url) return null;
    const isVideo = isVideoMediaUrl(url);
    const media = document.createElement(isVideo ? 'video' : 'img');
    media.className = className;
    if (isVideo) {
        media.playsInline = true;
        media.preload = options.controls ? 'metadata' : 'none';
        if (options.controls) media.controls = true;
        if (options.autoplay) {
            media.muted = true;
            media.loop = true;
        }
    } else {
        media.alt = '我们的回忆';
        if (options.priority) {
            media.loading = 'eager';
            media.fetchPriority = 'high';
        } else {
            media.loading = 'lazy';
            media.fetchPriority = 'auto';
        }
        media.decoding = 'async';

        // 骨架屏流光占位与加载完成后平滑淡入
        media.classList.add('media-loading');
        const handleLoaded = () => {
            media.classList.remove('media-loading');
            media.classList.add('media-loaded');
        };
        if (media.complete) {
            handleLoaded();
        } else {
            media.addEventListener('load', handleLoaded, { once: true });
            media.addEventListener('error', handleLoaded, { once: true });
        }
    }
    media.src = url;
    if (isVideo) setupMomentVideoPlayback(media, options.autoplay === true);
    if (options.lightbox) {
        media.dataset.momentAction = 'open-lightbox';
        media.tabIndex = 0;
        media.setAttribute('role', 'button');
        media.setAttribute('aria-label', isVideo ? '打开视频预览' : '打开图片预览');
    }
    return media;
}

function createMomentCardElement(item, options = {}) {
    const momentId = normalizeMomentId(item && item.id);
    if (!momentId) return null;

    const isPriorityCard = options?.isInitialBatch && (options?.cardIndex ?? 0) < 3;

    let parsedMoment = null;
    if (item.type === 'moment') {
        try {
            const parsed = JSON.parse(item.content);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) parsedMoment = parsed;
        } catch (error) {
            console.warn('忽略格式无效的动态内容:', error);
        }
    }
    const isMilestone = Boolean(parsedMoment && parsedMoment.is_milestone === true);
    const isEdited = Boolean(parsedMoment && (parsedMoment.updated_at || parsedMoment.edited_at));
    const card = createMomentNode('div', `moment-card${isMilestone ? ' milestone' : ''}`);
    card.id = `card-${momentId}`;

    const header = createMomentNode('div', 'card-header');
    const meta = createMomentNode('div', 'card-meta');
    const createdAt = new Date(item.created_at);
    const dateText = Number.isNaN(createdAt.getTime())
        ? ''
        : createdAt.toLocaleString('zh-CN', { hour12: false });
    meta.appendChild(createMomentNode('span', 'time-text', dateText));

    if (isEdited) {
        const editedDate = new Date(parsedMoment.updated_at || parsedMoment.edited_at);
        const editedTitle = Number.isNaN(editedDate.getTime())
            ? '已编辑'
            : `最后编辑于 ${editedDate.toLocaleString('zh-CN', { hour12: false })}`;
        const editedBadge = createMomentNode('span', 'moment-edited-badge', '已编辑');
        editedBadge.title = editedTitle;
        meta.appendChild(editedBadge);
    }

    const author = typeof item.author === 'string' ? item.author : '';
    if (author) {
        const authorProfile = allProfilesCache[author] || {};
        const authorBadgeClass = author === '小蛇' ? 'author-snake' : (author === '小奚' ? 'author-xi' : '');
        const authorBadge = createMomentNode('span', `author-badge${authorBadgeClass ? ` ${authorBadgeClass}` : ''}`);
        authorBadge.dataset.momentAction = 'open-profile';
        authorBadge.dataset.author = author;
        authorBadge.tabIndex = 0;
        authorBadge.setAttribute('role', 'button');
        authorBadge.title = '点击查看主页';
        authorBadge.style.cursor = 'pointer';
        const avatarUrl = getMomentProfileAvatarUrl(authorProfile);
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
            authorBadge.appendChild(document.createTextNode(author === '小蛇' ? '🐍 ' : (author === '小奚' ? '🐟 ' : '')));
        }
        authorBadge.appendChild(document.createTextNode(String(authorProfile.nickname || author)));
        meta.appendChild(authorBadge);
    }
    if (isMilestone) meta.appendChild(createMomentNode('span', 'milestone-badge-timeline', '🏆 大事记'));
    header.appendChild(meta);

    const canDelete = item.user_id === currentAuthUser?.id
        && !Number.isNaN(createdAt.getTime())
        && Date.now() - createdAt.getTime() < 86400000;

    const actionsMenu = createMomentNode('div', 'moment-actions-menu');
    actionsMenu.id = `moment-menu-${momentId}`;

    const triggerBtn = createMomentNode('button', 'moment-menu-trigger');
    triggerBtn.type = 'button';
    triggerBtn.setAttribute('aria-label', '更多操作');
    triggerBtn.setAttribute('aria-haspopup', 'true');
    triggerBtn.setAttribute('aria-expanded', 'false');
    triggerBtn.dataset.momentAction = 'toggle-menu';
    triggerBtn.dataset.momentId = String(momentId);
    triggerBtn.appendChild(document.createTextNode('···'));
    actionsMenu.appendChild(triggerBtn);

    const dropdown = createMomentNode('div', 'moment-menu-dropdown');
    dropdown.id = `moment-dropdown-${momentId}`;
    dropdown.setAttribute('role', 'menu');

    const editItem = createMomentNode('button', 'moment-menu-item');
    editItem.type = 'button';
    editItem.setAttribute('role', 'menuitem');
    editItem.dataset.momentAction = 'edit';
    editItem.dataset.momentId = String(momentId);
    editItem.appendChild(document.createTextNode('✏️ 编辑'));
    dropdown.appendChild(editItem);

    if (canDelete) {
        const deleteItem = createMomentNode('button', 'moment-menu-item moment-menu-item--danger');
        deleteItem.type = 'button';
        deleteItem.setAttribute('role', 'menuitem');
        deleteItem.dataset.momentAction = 'delete';
        deleteItem.dataset.momentId = String(momentId);
        deleteItem.appendChild(document.createTextNode('🗑️ 撤回'));
        dropdown.appendChild(deleteItem);
    }

    actionsMenu.appendChild(dropdown);
    header.appendChild(actionsMenu);
    card.appendChild(header);

    if (item.type === 'text') {
        const textElement = createCardTextElement(item.content, momentId);
        if (textElement) card.appendChild(textElement);
    } else if (item.type === 'photo') {
        const media = createMomentMedia(item.content, 'card-img', { lightbox: true, priority: isPriorityCard });
        if (media) card.appendChild(media);
    } else if (item.type === 'audio') {
        const audio = createMomentAudio(item.content);
        if (audio) card.appendChild(audio);
    } else if (parsedMoment) {
        const textElement = createCardTextElement(parsedMoment.text, momentId);
        if (textElement) card.appendChild(textElement);
        const audio = createMomentAudio(parsedMoment.audio);
        if (audio) card.appendChild(audio);

        const images = Array.isArray(parsedMoment.images)
            ? parsedMoment.images.map(url => sanitizeMediaUrl(url)).filter(Boolean)
            : [];
        if (images.length === 1) {
            const single = createMomentMedia(images[0], 'moment-single-image', {
                controls: isVideoMediaUrl(images[0]),
                lightbox: !isVideoMediaUrl(images[0]),
                priority: isPriorityCard
            });
            if (single) {
                if (single.tagName === 'VIDEO') Object.assign(single.style, { width: '100%', borderRadius: '12px', marginTop: '10px' });
                card.appendChild(single);
            }
        } else if (images.length > 1) {
            const grid = createMomentNode('div', 'moment-grid');
            grid.id = `moment-grid-${momentId}`;
            const INITIAL_DISPLAY_COUNT = 9;
            images.forEach((url, index) => {
                const isHidden = index >= INITIAL_DISPLAY_COUNT;
                const media = createMomentMedia(url, `moment-grid-item${isHidden ? ' hidden-image' : ''}`, {
                    autoplay: isVideoMediaUrl(url),
                    lightbox: true,
                    priority: isPriorityCard && index < 4
                });
                if (!media) return;
                if (isHidden) media.style.display = 'none';
                if (media.tagName === 'VIDEO') Object.assign(media.style, { cursor: 'zoom-in', objectFit: 'cover' });
                grid.appendChild(media);
            });
            card.appendChild(grid);
            if (images.length > INITIAL_DISPLAY_COUNT) {
                const remainingCount = images.length - INITIAL_DISPLAY_COUNT;
                const showAll = createMomentNode('button', 'show-all-images-btn', `展开剩余 ${remainingCount} 张照片 ↓`);
                showAll.type = 'button';
                showAll.id = `show-images-btn-${momentId}`;
                showAll.dataset.momentAction = 'show-images';
                showAll.dataset.momentId = String(momentId);
                showAll.dataset.remaining = String(remainingCount);
                card.appendChild(showAll);
            }
        }
    }

    const hasStarred = typeof starredMomentIds !== 'undefined' && starredMomentIds.has(momentId);
    const likeBar = createMomentNode('div', 'moment-like-bar');
    const likeButton = createMomentNode('button', 'moment-like-btn');
    likeButton.type = 'button';
    likeButton.id = `moment-like-btn-${momentId}`;
    likeButton.dataset.momentAction = 'toggle-like';
    likeButton.dataset.momentId = String(momentId);
    likeButton.append(
        createMomentNode('span', 'ml-heart', '🤍'),
        createMomentNode('span', 'ml-count', '喜欢')
    );
    likeButton.querySelector('.ml-count').id = `moment-like-count-${momentId}`;
    const starButton = createMomentNode('button', `moment-star-btn${hasStarred ? ' starred' : ''}`, hasStarred ? '⭐ 已收藏' : '☆ 收藏');
    starButton.type = 'button';
    starButton.id = `moment-star-btn-${momentId}`;
    starButton.dataset.momentAction = 'toggle-star';
    starButton.dataset.momentId = String(momentId);
    const starPending = typeof pendingMomentStarIds !== 'undefined' && pendingMomentStarIds.has(momentId);
    starButton.disabled = starPending;
    if (starPending) starButton.setAttribute('aria-busy', 'true');
    const likers = createMomentNode('span', 'moment-like-likers');
    likers.id = `moment-like-likers-${momentId}`;
    likeBar.append(likeButton, starButton, likers);
    card.appendChild(likeBar);

    const commentToggle = createMomentNode('button', 'comment-toggle-btn');
    commentToggle.type = 'button';
    commentToggle.id = `comment-toggle-${momentId}`;
    commentToggle.dataset.momentAction = 'toggle-comments';
    commentToggle.dataset.momentId = String(momentId);
    commentToggle.setAttribute('aria-controls', `comments-${momentId}`);
    commentToggle.setAttribute('aria-expanded', 'false');
    commentToggle.appendChild(document.createTextNode('💬 '));
    const commentCount = createMomentNode('span', '', '评论');
    commentCount.id = `comment-count-${momentId}`;
    commentToggle.appendChild(commentCount);
    card.appendChild(commentToggle);

    const commentSection = createMomentNode('div', 'comment-section');
    commentSection.id = `comments-${momentId}`;
    commentSection.style.display = 'none';
    commentSection.setAttribute('aria-hidden', 'true');
    const commentList = createMomentNode('div', 'comment-list');
    commentList.id = `comment-list-${momentId}`;
    const writeButton = createMomentNode('button', 'comment-write-btn', '✏️ 写评论');
    writeButton.type = 'button';
    writeButton.id = `comment-write-btn-${momentId}`;
    writeButton.dataset.momentAction = 'write-comment';
    writeButton.dataset.momentId = String(momentId);
    commentSection.append(commentList, writeButton);

    const inputArea = createMomentNode('div', 'comment-input-area');
    inputArea.id = `comment-input-area-${momentId}`;
    inputArea.style.display = 'none';
    const inputColumn = createMomentNode('div');
    Object.assign(inputColumn.style, { display: 'flex', flexDirection: 'column', gap: '8px' });
    const inputAvatar = createMomentNode('div');
    inputAvatar.id = `comment-input-avatar-${momentId}`;
    Object.assign(inputAvatar.style, { display: 'flex', alignItems: 'center' });
    const textarea = document.createElement('textarea');
    textarea.className = 'comment-textarea';
    textarea.id = `comment-text-${momentId}`;
    textarea.placeholder = '写下你的想法…';
    textarea.setAttribute('aria-label', '写下评论');
    textarea.rows = 2;
    textarea.style.marginTop = '0';
    const previews = createMomentNode('div', 'comment-img-previews');
    previews.id = `comment-img-previews-${momentId}`;
    inputColumn.append(inputAvatar, textarea, previews);

    const submitRow = createMomentNode('div', 'comment-submit-row');
    submitRow.style.justifyContent = 'space-between';
    const buttonGroup = createMomentNode('div');
    Object.assign(buttonGroup.style, { display: 'flex', gap: '6px', alignItems: 'center' });
    const cancelButton = createMomentNode('button', 'comment-cancel-btn', '取消');
    cancelButton.type = 'button';
    cancelButton.dataset.momentAction = 'cancel-comment';
    cancelButton.dataset.momentId = String(momentId);
    const imageButton = createMomentNode('button', 'comment-img-upload-btn', '🖼️ 图片');
    imageButton.type = 'button';
    imageButton.dataset.momentAction = 'choose-comment-images';
    imageButton.dataset.momentId = String(momentId);
    const imageInput = document.createElement('input');
    imageInput.type = 'file';
    imageInput.id = `comment-img-input-${momentId}`;
    imageInput.accept = 'image/*';
    imageInput.multiple = true;
    imageInput.style.display = 'none';
    imageInput.dataset.momentAction = 'comment-images-selected';
    imageInput.dataset.momentId = String(momentId);
    buttonGroup.append(cancelButton, imageButton, imageInput);
    const submitButton = createMomentNode('button', 'comment-submit-btn', '发送 💌');
    submitButton.type = 'button';
    submitButton.dataset.momentAction = 'submit-comment';
    submitButton.dataset.momentId = String(momentId);
    submitRow.append(buttonGroup, submitButton);
    inputArea.append(inputColumn, submitRow);
    commentSection.appendChild(inputArea);
    card.appendChild(commentSection);
    return card;
}

function focusLocatedMomentCard(card) {
    if (!card) return;
    const reveal = () => {
        if (!card.isConnected) return;
        card.classList.add('visible', 'blind-box-target');
        const reduceMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });

        if (!card.hasAttribute('tabindex')) {
            card.tabIndex = -1;
            card.addEventListener('blur', () => card.removeAttribute('tabindex'), { once: true });
        }
        try {
            card.focus({ preventScroll: true });
        } catch (_error) {
            card.focus();
        }
        setTimeout(() => card.classList.remove('blind-box-target'), 2500);
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(reveal));
    } else {
        setTimeout(reveal, 0);
    }
}

function locateMomentOnTimeline(moment, options = {}) {
    const momentId = normalizeMomentId(moment?.id);
    const content = document.getElementById('timeline-content');
    if (!momentId || !content || !hasMomentAuthContext()) return false;

    let navigationSucceeded = true;
    if (typeof appReplace === 'function') {
        navigationSucceeded = appReplace('/', {
            force: true,
            focus: false,
            scroll: false,
            reason: 'locate-moment'
        });
    } else {
        window.location.hash = '#/';
    }
    if (navigationSucceeded === false) return false;

    const existingCard = document.getElementById(`card-${momentId}`);
    if (existingCard) {
        focusLocatedMomentCard(existingCard);
        return true;
    }

    const card = createMomentCardElement(moment);
    if (!card) {
        if (typeof showToast === 'function') showToast('这条动态暂时无法显示。');
        return false;
    }

    // 旧动态或被筛选隐藏的动态使用单条原文视图，避免为定位连续加载大量分页。
    activeMomentFetchRequest += 1;
    isLoading = false;
    momentLoadingAuthEpoch = null;
    scrollObserver?.disconnect();
    if (typeof clearAllCommentImageSelections === 'function') clearAllCommentImageSelections();
    releaseMomentVideosWithin(content, true);

    const backWrap = createMomentNode('div', 'blind-box-back moment-locate-back');
    const backButton = createMomentNode('button', '', options.backLabel || '🔙 返回动态列表');
    backButton.type = 'button';
    backButton.addEventListener('click', () => fetchMoments(false));
    backWrap.appendChild(backButton);
    content.replaceChildren(backWrap, card);

    currentPage = 0;
    hasMore = false;
    momentTimelineCursor = null;
    renderedMomentIds.clear();
    renderedMomentIds.add(momentId);

    if (typeof initScrollReveal === 'function') initScrollReveal();
    if (typeof loadCommentCounts === 'function') loadCommentCounts([momentId]);
    if (typeof loadMomentLikes === 'function') loadMomentLikes([momentId]);
    focusLocatedMomentCard(card);
    return true;
}

function toggleMomentActionMenu(momentId) {
    const dropdown = document.getElementById(`moment-dropdown-${momentId}`);
    const trigger = document.querySelector(`[data-moment-action="toggle-menu"][data-moment-id="${momentId}"]`);
    if (!dropdown) return;
    const isOpen = dropdown.classList.contains('is-open');
    closeAllMomentActionMenus();
    if (!isOpen) {
        dropdown.classList.add('is-open');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
    }
}

function closeAllMomentActionMenus() {
    document.querySelectorAll('.moment-menu-dropdown.is-open').forEach(menu => {
        menu.classList.remove('is-open');
    });
    document.querySelectorAll('.moment-menu-trigger[aria-expanded="true"]').forEach(btn => {
        btn.setAttribute('aria-expanded', 'false');
    });
}

function runMomentAction(actionElement) {
    const momentId = normalizeMomentId(actionElement.dataset.momentId);
    const action = actionElement.dataset.momentAction;
    if (action !== 'open-profile' && action !== 'open-lightbox' && !momentId) return;
    if (action === 'toggle-menu') {
        toggleMomentActionMenu(momentId);
    } else if (action === 'edit') {
        closeAllMomentActionMenus();
        openMomentEditModal(momentId);
    } else if (action === 'delete') {
        closeAllMomentActionMenus();
        confirmDelete(momentId);
    }
    else if (action === 'open-profile' && typeof openProfilePage === 'function') openProfilePage(actionElement.dataset.author || '');
    else if (action === 'open-lightbox' && typeof openLightbox === 'function') openLightbox(actionElement.currentSrc || actionElement.src);
    else if (action === 'show-images') showAllImages(momentId);
    else if (action === 'toggle-text') toggleTextCollapse(momentId);
    else if (action === 'toggle-like' && typeof toggleMomentLike === 'function') toggleMomentLike(momentId);
    else if (action === 'toggle-star' && typeof toggleMomentStar === 'function') toggleMomentStar(momentId);
    else if (action === 'toggle-comments' && typeof toggleComments === 'function') toggleComments(momentId);
    else if (action === 'write-comment' && typeof checkPasswordForComment === 'function') checkPasswordForComment(momentId);
    else if (action === 'cancel-comment' && typeof cancelCommentInput === 'function') cancelCommentInput(momentId);
    else if (action === 'choose-comment-images') document.getElementById(`comment-img-input-${momentId}`)?.click();
    else if (action === 'submit-comment' && typeof submitComment === 'function') submitComment(momentId);
}

document.addEventListener('click', event => {
    if (!event.target.closest('.moment-actions-menu')) {
        closeAllMomentActionMenus();
    }
    const actionElement = event.target.closest('[data-moment-action]');
    if (actionElement) runMomentAction(actionElement);
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const actionElement = event.target.closest('[data-moment-action="open-profile"], [data-moment-action="open-lightbox"]');
    if (!actionElement) return;
    event.preventDefault();
    runMomentAction(actionElement);
});

document.addEventListener('change', event => {
    const input = event.target.closest('[data-moment-action="comment-images-selected"]');
    if (!input || typeof handleCommentImgSelect !== 'function') return;
    const momentId = normalizeMomentId(input.dataset.momentId);
    if (momentId) handleCommentImgSelect(event, momentId);
});

window.showAllImages = function(id) {
    const grid = document.getElementById(`moment-grid-${id}`);
    const btn = document.getElementById(`show-images-btn-${id}`);
    if (!grid) return;
    const hiddenImgs = grid.querySelectorAll('.hidden-image');
    const isExpanded = btn && btn.dataset.expanded === 'true';
    if (!isExpanded) {
        hiddenImgs.forEach(img => {
            img.style.display = 'block';
            if (img instanceof HTMLVideoElement) refreshMomentVideoPlayback(img);
        });
        if (btn) {
            btn.dataset.expanded = 'true';
            btn.textContent = '收起照片 ↑';
        }
    } else {
        hiddenImgs.forEach(img => {
            img.style.display = 'none';
            if (img instanceof HTMLVideoElement) releaseMomentVideo(img, false);
        });
        if (btn) {
            btn.dataset.expanded = 'false';
            const remaining = btn.dataset.remaining || '';
            btn.textContent = remaining ? `展开剩余 ${remaining} 张照片 ↓` : '展开照片 ↓';
        }
    }
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
    if (typeof appNavigate === 'function') {
        appNavigate('/memories/filter');
        return;
    }
    window.location.hash = '#/memories/filter';
}

function enterFilterPage() {
    populateFilterYears();
}

function populateFilterYears() {
    const select = document.getElementById('filterYear');
    if (!select) return;
    const selected = select.value;
    const firstYear = Number.isFinite(startDate?.getFullYear?.()) ? startDate.getFullYear() : new Date().getFullYear();
    const lastYear = Math.max(firstYear, new Date().getFullYear());
    select.replaceChildren(new Option('所有年份', ''));
    for (let year = firstYear; year <= lastYear; year += 1) {
        select.appendChild(new Option(`${year}年`, String(year)));
    }
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function closeFilterModal() {
    if (typeof appBack === 'function') {
        appBack('/');
        return;
    }
    window.location.hash = '#/';
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
    const yearSelect = document.getElementById('filterYear');
    const monthSelect = document.getElementById('filterMonth');
    currentFilters.year = yearSelect ? yearSelect.value : '';
    currentFilters.month = monthSelect ? monthSelect.value : '';
    // 单独选择月份时明确按当前自然年筛选，避免 UI 显示已筛选但查询并未生效。
    if (currentFilters.month && !currentFilters.year) {
        currentFilters.year = String(new Date().getFullYear());
        if (yearSelect) yearSelect.value = currentFilters.year;
    }
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
    const fab = document.getElementById('fab-filter') || document.querySelector('.fab-item-filter');
    if (!indicator) return;
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
        if (fab) fab.classList.add('active');
    } else {
        indicator.classList.remove('show');
        if (fab) fab.classList.remove('active');
    }
}

let activeMomentFetchRequest = 0;
let momentLoadingAuthEpoch = null;

async function fetchMoments(append = false) {
    const contentDiv = document.getElementById('timeline-content');
    if (!hasMomentAuthContext()) {
        if (scrollObserver) scrollObserver.disconnect();
        if (typeof clearAllCommentImageSelections === 'function') clearAllCommentImageSelections();
        if (contentDiv) {
            releaseMomentVideosWithin(contentDiv, true);
            contentDiv.replaceChildren();
        }
        return;
    }
    const requestAuthEpoch = getMomentAuthEpoch();
    if (append && isLoading && momentLoadingAuthEpoch === requestAuthEpoch) return;
    if (append && !hasMore) return;

    const requestId = ++activeMomentFetchRequest;
    isLoading = true;
    momentLoadingAuthEpoch = requestAuthEpoch;
    if (!contentDiv) {
        isLoading = false;
        momentLoadingAuthEpoch = null;
        return;
    }

    const finishRequest = () => {
        if (requestId === activeMomentFetchRequest) {
            isLoading = false;
            momentLoadingAuthEpoch = null;
        }
    };

    if (!append) {
        if (typeof clearAllCommentImageSelections === 'function') clearAllCommentImageSelections();
        currentPage = 0;
        hasMore = true;
        momentTimelineCursor = null;
        renderedMomentIds.clear();
        releaseMomentVideosWithin(contentDiv, true);
        contentDiv.replaceChildren(createMomentNode('div', 'empty-state', '正在加载甜蜜回忆…'));
    }

    let query = supabaseClient.from('moments')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

    if (append && momentTimelineCursor) {
        const cursorCreatedAt = String(momentTimelineCursor.createdAt)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"');
        query = query.or(
            `created_at.lt."${cursorCreatedAt}",and(created_at.eq."${cursorCreatedAt}",id.lt.${momentTimelineCursor.id})`
        );
    }

    // 应用筛选条件
    if (currentFilters.authors.length > 0) {
        query = query.in('author', currentFilters.authors);
    }
    if (currentFilters.types.length > 0) {
        if (currentFilters.types.includes('audio') && !currentFilters.types.includes('moment')) {
            // 录音既可能是旧 audio 行，也可能嵌在新版 moment JSON 中。
            query = query.or(`type.in.(${currentFilters.types.join(',')}),and(type.eq.moment,content.ilike.%\"audio\"%)`);
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

        // 日记按北京时间自然月划分，显式使用 +08:00，避免浏览器时区改变边界。
        const formatMonthStart = (year, monthIndex) =>
            `${year}-${String(monthIndex + 1).padStart(2, '0')}-01T00:00:00+08:00`;
        let startDateStr = new Date(formatMonthStart(startYear, startMonth)).toISOString();
        let endDateStr = new Date(formatMonthStart(endYear, endMonth)).toISOString();
        query = query.gte('created_at', startDateStr).lt('created_at', endDateStr);
    }

    const { data, error } = await query;
    if (requestId !== activeMomentFetchRequest || !isMomentAuthEpochCurrent(requestAuthEpoch)) {
        finishRequest();
        return;
    }

    if (error) {
        if (!append) {
            console.error('读取动态失败:', error);
            const errorText = createMomentNode('p', '', '读取数据失败，请稍后重试。');
            Object.assign(errorText.style, { color: 'var(--primary)', textAlign: 'center' });
            contentDiv.replaceChildren(errorText);
        }
        finishRequest();
        return;
    }

    const pageData = data || [];
    if (pageData.length < PAGE_SIZE) hasMore = false;

    const lastItem = pageData[pageData.length - 1];
    const lastItemId = normalizeMomentId(lastItem?.id);
    if (lastItem && typeof lastItem.created_at === 'string' && lastItem.created_at && lastItemId) {
        momentTimelineCursor = {
            createdAt: lastItem.created_at,
            id: lastItemId
        };
    } else if (pageData.length > 0) {
        hasMore = false;
    }

    const uniquePageData = pageData.filter(item => {
        const itemId = normalizeMomentId(item?.id);
        if (!itemId || renderedMomentIds.has(itemId)) return false;
        renderedMomentIds.add(itemId);
        return true;
    });
    const renderData = typeof batchHydrateMomentMediaRecords === 'function'
        ? await batchHydrateMomentMediaRecords(uniquePageData)
        : (typeof hydrateMomentMediaRecord === 'function'
            ? await Promise.all(uniquePageData.map(item => hydrateMomentMediaRecord(item)))
            : uniquePageData);
    if (requestId !== activeMomentFetchRequest || !isMomentAuthEpochCurrent(requestAuthEpoch)) {
        finishRequest();
        return;
    }

    if (!append && pageData.length === 0) {
        contentDiv.replaceChildren(createMomentNode('div', 'empty-state', '还没有记录哦，快去添加第一条回忆吧！'));
        finishRequest();
        return;
    }

    if (!append) {
        releaseMomentVideosWithin(contentDiv, true);
        contentDiv.replaceChildren();
    }

    // 移除已有的加载指示器
    const existingLoader = contentDiv.querySelector('.load-more-indicator');
    if (existingLoader) existingLoader.remove();

    // 加载星标收藏数据以供渲染
    if (typeof loadMomentStars === 'function') {
        await loadMomentStars();
        if (requestId !== activeMomentFetchRequest || !isMomentAuthEpochCurrent(requestAuthEpoch)) {
            finishRequest();
            return;
        }
    }

    // 预热首屏前 4 张图片
    if (!append) {
        const topUrls = [];
        renderData.slice(0, 3).forEach(item => {
            if (item.type === 'photo' && item.content) topUrls.push(item.content);
            else if (item.type === 'moment' && typeof item.content === 'string') {
                try {
                    const parsed = JSON.parse(item.content);
                    if (Array.isArray(parsed.images)) topUrls.push(...parsed.images.slice(0, 4));
                } catch (_e) {}
            }
        });
        topUrls.slice(0, 4).forEach(url => {
            const safe = sanitizeMediaUrl(url);
            if (safe && !isVideoMediaUrl(safe)) {
                const preloadImg = new Image();
                preloadImg.decoding = 'async';
                preloadImg.src = safe;
            }
        });
    }

    // 渲染新卡片
    const fragment = document.createDocumentFragment();
    renderData.forEach((item, cardIndex) => {
        const card = createMomentCardElement(item, { cardIndex, isInitialBatch: !append });
        if (card) fragment.appendChild(card);
    });
    const newVideos = Array.from(fragment.querySelectorAll('video'));
    contentDiv.appendChild(fragment);
    newVideos.forEach(video => refreshMomentVideoPlayback(video));

    // 触发滚动入场
    setTimeout(() => initScrollReveal(), 50);

    // 添加加载更多提示
    if (hasMore) {
        const loader = createMomentNode('div', 'load-more-indicator');
        loader.append(
            createMomentNode('span', 'load-more-spinner'),
            document.createTextNode('下滑加载更多回忆…')
        );
        contentDiv.appendChild(loader);
    }

    currentPage++;

    // 批量加载评论计数
    loadCommentCounts(renderData.map(item => item.id));

    // 批量加载动态点赞
    loadMomentLikes(renderData.map(item => item.id));

    // 设置滚动观察器
    setupScrollObserver();
    finishRequest();
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
    if (!hasMomentAuthContext()) {
        if (typeof openLoginModal === 'function') openLoginModal();
        return;
    }
    if (!confirm('确定要撤回这条回忆吗？此操作不可逆哦 💖')) {
        return;
    }
    deleteMoment(id);
}

async function deleteMoment(id) {
    if (!hasMomentAuthContext()) return;
    const momentId = normalizeMomentId(id);
    if (!momentId) return;
    const requestAuthEpoch = getMomentAuthEpoch();
    const { data: deleted, error } = await supabaseClient.rpc('recall_and_delete_moment', {
        p_moment_id: momentId
    });
    if (!isMomentAuthEpochCurrent(requestAuthEpoch)) return;
    if (error || deleted !== true) {
        console.error('撤回动态失败:', error);
        alert('撤回失败。仅支持撤回 24 小时内由当前账号发布的动态。');
    } else {
        const card = document.getElementById('card-' + momentId);
        if (card) {
            releaseMomentVideosWithin(card, true);
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0';
            card.style.transform = 'translateX(-16px)';
            setTimeout(() => fetchMoments(), 300);
        } else fetchMoments();
    }
}
