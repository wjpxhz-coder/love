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
    if (!content.dataset.lightboxBound) {
        content.dataset.lightboxBound = 'true';
        content.addEventListener('click', event => {
            const actionEl = event.target.closest('[data-moment-action="open-lightbox"]');
            if (actionEl && typeof runMomentAction === 'function') {
                runMomentAction(actionEl);
            }
        });
    }
    content.classList.remove('blind-box-card-develop');
    void content.offsetWidth;
    content.classList.add('blind-box-card-develop');
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
                    const posterUrl = (video && parsed.video_posters && (parsed.video_posters[parsed.images[0]])) || '';
                    appendBlindBoxMedia(content, parsed.images[0], 'blind-box-img', {
                        controls: video,
                        lightbox: !video,
                        poster: posterUrl,
                        preload: 'none'
                    });
                } else {
                    const grid = document.createElement('div');
                    grid.className = 'moment-grid blind-box-grid';
                    try {
                        grid.dataset.momentImages = JSON.stringify(parsed.images.slice(0, 9).map(u => sanitizeMediaUrl(u)).filter(Boolean));
                    } catch (_e) {}
                    parsed.images.slice(0, 9).forEach((rawUrl, index) => {
                        const url = sanitizeMediaUrl(rawUrl);
                        const video = typeof isVideoMediaUrl === 'function' && isVideoMediaUrl(url);
                        const posterUrl = (video && parsed.video_posters && (parsed.video_posters[url] || parsed.video_posters[rawUrl])) || '';
                        const media = typeof createMomentMedia === 'function'
                            ? createMomentMedia(url, 'moment-grid-item', { autoplay: false, preload: 'none', lightbox: true, poster: posterUrl })
                            : null;
                        if (media) {
                            if (video) {
                                const wrap = document.createElement('div');
                                wrap.className = 'moment-grid-video-wrap';
                                wrap.dataset.momentAction = 'open-lightbox';
                                wrap.dataset.mediaSrc = url;
                                wrap.tabIndex = 0;
                                wrap.setAttribute('role', 'button');
                                wrap.setAttribute('aria-label', '打开视频预览');
                                wrap.appendChild(media);
                                const badge = document.createElement('span');
                                badge.className = 'moment-video-badge';
                                badge.textContent = '▶';
                                wrap.appendChild(badge);
                                wrap.dataset.mediaIndex = String(index);
                                grid.appendChild(wrap);
                            } else {
                                media.dataset.mediaIndex = String(index);
                                grid.appendChild(media);
                            }
                        }
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
    if (!moment || !isAuthenticated()) return;
    if (typeof locateMomentOnTimeline === 'function') {
        locateMomentOnTimeline(moment, { backLabel: '🔙 返回全部回忆' });
    }
}

function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
}

function loadPolaroidImage(url) {
    return new Promise((resolve) => {
        if (!url) {
            resolve(null);
            return;
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 8000);
        img.onload = () => {
            clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            clearTimeout(timer);
            resolve(null);
        };
        img.src = url;
    });
}

function wrapPolaroidTextLines(ctx, text, maxWidth, maxLines = 5) {
    const normalized = String(text || '').replace(/\r/g, '').trim() || '✨ 珍藏在时光里的温柔碎片';
    const paragraphs = normalized.split('\n');
    const lines = [];

    for (const para of paragraphs) {
        const chars = Array.from(para.trim() || ' ');
        let currentLine = '';
        for (const ch of chars) {
            const testLine = currentLine + ch;
            if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = ch;
                if (lines.length >= maxLines) break;
            } else {
                currentLine = testLine;
            }
        }
        if (lines.length >= maxLines) {
            const lastIdx = maxLines - 1;
            lines[lastIdx] = lines[lastIdx].replace(/.$/, '…');
            break;
        }
        if (currentLine) {
            lines.push(currentLine);
            if (lines.length >= maxLines) break;
        }
    }
    return lines;
}

window.exportBlindBoxPolaroid = async function() {
    const moment = window.currentBlindBoxMoment;
    if (!moment) {
        if (typeof showToast === 'function') showToast('请先抽取一张盲盒回忆再生成纪念卡哦 🎲');
        return;
    }

    const btn = document.getElementById('btn-blindbox-polaroid');
    const prevLabel = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 正在显影拍立得...';
    }

    try {
        let imageUrl = '';
        let bodyText = '';
        if (moment.type === 'photo') {
            imageUrl = sanitizeMediaUrl(moment.content);
            bodyText = '📷 定格的温柔瞬间';
        } else if (moment.type === 'audio') {
            bodyText = '🎙️ 藏在声音里的心动悄悄话';
        } else if (moment.type === 'moment') {
            try {
                const parsed = JSON.parse(moment.content || '{}');
                bodyText = String(parsed.text || '').trim();
                const images = Array.isArray(parsed.images) ? parsed.images : [];
                const firstVisual = images.find(u => {
                    const clean = sanitizeMediaUrl(u);
                    return clean && !(typeof isVideoMediaUrl === 'function' && isVideoMediaUrl(clean));
                });
                if (firstVisual) imageUrl = sanitizeMediaUrl(firstVisual);
                if (!bodyText && parsed.audio) bodyText = '🎙️ 附带一段温柔语音记录';
            } catch (_e) {
                bodyText = String(moment.content || '').trim();
            }
        } else {
            bodyText = String(moment.content || '').trim();
        }

        const loadedImg = await loadPolaroidImage(imageUrl);

        const canvas = document.createElement('canvas');
        const width = 720;
        const height = 960;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        // 1. 柔和渐变暖色背景
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, '#fff7f9');
        bgGrad.addColorStop(0.5, '#fdf2f7');
        bgGrad.addColorStop(1, '#f8eef9');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // 2. 拍立得白色相纸外框与立体阴影
        const cardX = 48;
        const cardY = 44;
        const cardW = width - cardX * 2;
        const cardH = height - cardY * 2;

        ctx.save();
        ctx.shadowColor = 'rgba(180, 120, 145, 0.22)';
        ctx.shadowBlur = 34;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 16;
        drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, 26);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();

        // 3. 顶部专属标题水印
        ctx.fillStyle = '#c97a95';
        ctx.font = '600 22px "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif';
        ctx.textAlign = 'center';
        ctx.fillText('小蛇 ♡ 小奚 · 时光拍立得', width / 2, cardY + 46);

        // 4. 相纸主视觉区域（居中裁剪图片或信笺底纹）
        const frameX = cardX + 36;
        const frameY = cardY + 72;
        const frameW = cardW - 72;
        const frameH = 480;

        ctx.save();
        drawRoundedRectPath(ctx, frameX, frameY, frameW, frameH, 16);
        ctx.clip();

        if (loadedImg && loadedImg.width > 0 && loadedImg.height > 0) {
            const imgRatio = loadedImg.width / loadedImg.height;
            const boxRatio = frameW / frameH;
            let sx = 0, sy = 0, sw = loadedImg.width, sh = loadedImg.height;
            if (imgRatio > boxRatio) {
                sw = loadedImg.height * boxRatio;
                sx = (loadedImg.width - sw) / 2;
            } else {
                sh = loadedImg.width / boxRatio;
                sy = (loadedImg.height - sh) / 2;
            }
            ctx.drawImage(loadedImg, sx, sy, sw, sh, frameX, frameY, frameW, frameH);
        } else {
            const paperGrad = ctx.createLinearGradient(frameX, frameY, frameX + frameW, frameY + frameH);
            paperGrad.addColorStop(0, '#fff5f8');
            paperGrad.addColorStop(1, '#fcebf2');
            ctx.fillStyle = paperGrad;
            ctx.fillRect(frameX, frameY, frameW, frameH);

            ctx.strokeStyle = 'rgba(217, 138, 167, 0.22)';
            ctx.lineWidth = 1.5;
            for (let y = frameY + 76; y < frameY + frameH - 40; y += 46) {
                ctx.beginPath();
                ctx.moveTo(frameX + 42, y);
                ctx.lineTo(frameX + frameW - 42, y);
                ctx.stroke();
            }

            ctx.fillStyle = 'rgba(201, 122, 149, 0.26)';
            ctx.font = '48px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('🌸 💌 ✨', width / 2, frameY + 125);

            ctx.fillStyle = '#5e434d';
            ctx.font = '500 26px "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif';
            const innerLines = wrapPolaroidTextLines(ctx, bodyText, frameW - 96, 6);
            innerLines.forEach((line, idx) => {
                ctx.fillText(line, width / 2, frameY + 195 + idx * 46);
            });
        }
        ctx.restore();

        // 相纸内框细描边
        ctx.save();
        drawRoundedRectPath(ctx, frameX, frameY, frameW, frameH, 16);
        ctx.strokeStyle = 'rgba(217, 138, 167, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // 5. 摘录正文文案
        ctx.fillStyle = '#4a353d';
        ctx.font = '500 24px "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif';
        ctx.textAlign = 'center';
        const captionText = loadedImg ? (bodyText || '✨ 把这一刻的心动装进拍立得里') : '✨ 愿岁岁年年，都有今日的温柔回响';
        const captionLines = wrapPolaroidTextLines(ctx, captionText, frameW - 24, 3);
        captionLines.forEach((line, index) => {
            ctx.fillText(line, width / 2, frameY + frameH + 54 + index * 38);
        });

        // 6. 发布日期与作者昵称
        const createdAt = new Date(moment.created_at);
        const dateStr = Number.isNaN(createdAt.getTime())
            ? '美好的一天'
            : `${createdAt.getFullYear()}.${String(createdAt.getMonth() + 1).padStart(2, '0')}.${String(createdAt.getDate()).padStart(2, '0')} ${String(createdAt.getHours()).padStart(2, '0')}:${String(createdAt.getMinutes()).padStart(2, '0')}`;
        const profile = (typeof allProfilesCache === 'object' && allProfilesCache?.[moment.author]) || {};
        const authorName = profile.nickname || moment.author || '成员';

        ctx.fillStyle = '#9c7a86';
        ctx.font = '400 20px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(`📅 ${dateStr}  ·  来自 ${authorName}`, width / 2, cardY + cardH - 82);

        // 7. 底部相伴天数印章
        const refStartDate = typeof startDate !== 'undefined' && startDate instanceof Date
            ? startDate
            : new Date(2025, 1, 20, 0, 0, 0);
        const togetherDays = Math.max(1, Math.floor((Date.now() - refStartDate.getTime()) / 86400000));

        ctx.fillStyle = '#d46a8c';
        ctx.font = '600 21px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillText(`💖 我们已相伴 ${togetherDays} 天`, width / 2, cardY + cardH - 36);

        // 8. 导出 PNG 并触发下载
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('生成图片数据失败');

        const fileDateTag = Number.isNaN(createdAt.getTime())
            ? new Date().toISOString().slice(0, 10)
            : `${createdAt.getFullYear()}${String(createdAt.getMonth() + 1).padStart(2, '0')}${String(createdAt.getDate()).padStart(2, '0')}`;
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = `小蛇和小奚_回忆盲盒_${fileDateTag}.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

        if (typeof showToast === 'function') {
            showToast('📸 拍立得纪念卡已生成并保存！');
        }
    } catch (err) {
        console.error('导出盲盒拍立得纪念卡失败:', err);
        if (typeof showToast === 'function') {
            showToast('生成纪念卡失败，请稍后重试 😢');
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = prevLabel || '📸 生成拍立得纪念卡';
        }
    }
};

