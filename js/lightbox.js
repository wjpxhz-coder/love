// --- 灯箱与手势缩放引擎 ---
let lightboxPreviousFocus = null;
let lightboxPreviousBodyOverflow = '';
let lightboxInertState = [];

// 缩放与平移手势状态变量
let zoomScale = 1;
let zoomTranslateX = 0;
let zoomTranslateY = 0;
let zoomStartDistance = 0;
let zoomStartScale = 1;
let zoomStartX = 0;
let zoomStartY = 0;
let zoomLastTranslateX = 0;
let zoomLastTranslateY = 0;
let zoomIsPinching = false;
let zoomIsDragging = false;
let zoomLastTapTime = 0;
let zoomLastTapPos = { x: 0, y: 0 };
let zoomSingleTapTimeout = null;
let zoomHandlersAttached = false;

function applyLightboxTransform(animate = false) {
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    img.style.transition = animate ? 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
    img.style.transform = `translate3d(${zoomTranslateX}px, ${zoomTranslateY}px, 0) scale(${zoomScale})`;
    img.style.cursor = zoomScale > 1.05 ? (zoomIsDragging ? 'grabbing' : 'grab') : 'zoom-in';
}

function resetLightboxZoom(animate = false) {
    zoomScale = 1;
    zoomTranslateX = 0;
    zoomTranslateY = 0;
    zoomIsPinching = false;
    zoomIsDragging = false;
    if (zoomSingleTapTimeout) {
        clearTimeout(zoomSingleTapTimeout);
        zoomSingleTapTimeout = null;
    }
    applyLightboxTransform(animate);
}

function clampZoomBounds() {
    const img = document.getElementById('lightbox-img');
    const lightbox = document.getElementById('lightbox');
    if (!img || !lightbox || zoomScale <= 1.02) {
        zoomTranslateX = 0;
        zoomTranslateY = 0;
        return;
    }

    const viewportW = lightbox.clientWidth || window.innerWidth;
    const viewportH = lightbox.clientHeight || window.innerHeight;
    const baseW = img.offsetWidth || (viewportW * 0.9);
    const baseH = img.offsetHeight || (viewportH * 0.85);

    const scaledW = baseW * zoomScale;
    const scaledH = baseH * zoomScale;

    const maxPanX = Math.max(0, (scaledW - viewportW) / 2 + 20);
    const maxPanY = Math.max(0, (scaledH - viewportH) / 2 + 20);

    zoomTranslateX = Math.min(Math.max(zoomTranslateX, -maxPanX), maxPanX);
    zoomTranslateY = Math.min(Math.max(zoomTranslateY, -maxPanY), maxPanY);
}

function handleDoubleTapZoom(clientX, clientY) {
    if (zoomScale > 1.2) {
        resetLightboxZoom(true);
    } else {
        zoomScale = 2.5;
        const img = document.getElementById('lightbox-img');
        const imgRect = img ? img.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const centerX = imgRect.left + imgRect.width / 2;
        const centerY = imgRect.top + imgRect.height / 2;

        zoomTranslateX = (centerX - clientX) * 1.5;
        zoomTranslateY = (centerY - clientY) * 1.5;
        clampZoomBounds();
        applyLightboxTransform(true);
    }
}

function initLightboxZoomHandlers() {
    if (zoomHandlersAttached) return;
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    zoomHandlersAttached = true;

    // ── 手机端触摸手势（双指捏合缩放、双击放大、单指平移拖拽） ──
    img.addEventListener('touchstart', (e) => {
        if (zoomSingleTapTimeout) {
            clearTimeout(zoomSingleTapTimeout);
            zoomSingleTapTimeout = null;
        }

        if (e.touches.length === 2) {
            zoomIsPinching = true;
            zoomIsDragging = false;
            zoomStartDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            zoomStartScale = zoomScale;
            zoomStartX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            zoomStartY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            zoomLastTranslateX = zoomTranslateX;
            zoomLastTranslateY = zoomTranslateY;
        } else if (e.touches.length === 1) {
            const touch = e.touches[0];
            const now = performance.now();
            const timeDiff = now - zoomLastTapTime;
            const distDiff = Math.hypot(touch.clientX - zoomLastTapPos.x, touch.clientY - zoomLastTapPos.y);

            if (timeDiff < 320 && distDiff < 36) {
                // 判定为双击
                zoomLastTapTime = 0;
                handleDoubleTapZoom(touch.clientX, touch.clientY);
                return;
            }
            zoomLastTapTime = now;
            zoomLastTapPos = { x: touch.clientX, y: touch.clientY };

            if (zoomScale > 1.05) {
                zoomIsDragging = true;
                zoomStartX = touch.clientX;
                zoomStartY = touch.clientY;
                zoomLastTranslateX = zoomTranslateX;
                zoomLastTranslateY = zoomTranslateY;
            }
        }
    }, { passive: false });

    img.addEventListener('touchmove', (e) => {
        if (zoomIsPinching && e.touches.length === 2) {
            e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const factor = currentDist / (zoomStartDistance || 1);
            zoomScale = Math.min(Math.max(zoomStartScale * factor, 0.85), 4.5);
            applyLightboxTransform(false);
        } else if (zoomIsDragging && e.touches.length === 1 && zoomScale > 1.05) {
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - zoomStartX;
            const dy = touch.clientY - zoomStartY;
            zoomTranslateX = zoomLastTranslateX + dx;
            zoomTranslateY = zoomLastTranslateY + dy;
            applyLightboxTransform(false);
        }
    }, { passive: false });

    img.addEventListener('touchend', (e) => {
        if (zoomIsPinching) {
            zoomIsPinching = false;
            if (zoomScale < 1.05) {
                resetLightboxZoom(true);
            } else {
                zoomScale = Math.min(zoomScale, 4.0);
                clampZoomBounds();
                applyLightboxTransform(true);
            }
            return;
        }
        if (zoomIsDragging) {
            zoomIsDragging = false;
            clampZoomBounds();
            applyLightboxTransform(true);
            return;
        }

        // 单指轻击检测：如果在未放大状态下单指轻击，延时确认后关闭灯箱
        if (e.changedTouches.length === 1 && zoomScale <= 1.05) {
            const touch = e.changedTouches[0];
            const dist = Math.hypot(touch.clientX - zoomLastTapPos.x, touch.clientY - zoomLastTapPos.y);
            if (dist < 10) {
                zoomSingleTapTimeout = setTimeout(() => {
                    closeLightbox();
                }, 300);
            }
        }
    });

    img.addEventListener('touchcancel', () => {
        zoomIsPinching = false;
        zoomIsDragging = false;
        clampZoomBounds();
        applyLightboxTransform(true);
    });

    // ── 电脑端鼠标滚轮缩放与拖拽 ──
    img.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.3 : -0.3;
        const newScale = Math.min(Math.max(zoomScale + delta, 1), 4.5);
        if (newScale <= 1.02) {
            resetLightboxZoom(true);
        } else {
            zoomScale = newScale;
            clampZoomBounds();
            applyLightboxTransform(false);
        }
    }, { passive: false });

    img.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (zoomScale > 1.05) {
            zoomIsDragging = true;
            zoomStartX = e.clientX;
            zoomStartY = e.clientY;
            zoomLastTranslateX = zoomTranslateX;
            zoomLastTranslateY = zoomTranslateY;
            applyLightboxTransform(false);
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!zoomIsDragging) return;
        const dx = e.clientX - zoomStartX;
        const dy = e.clientY - zoomStartY;
        zoomTranslateX = zoomLastTranslateX + dx;
        zoomTranslateY = zoomLastTranslateY + dy;
        applyLightboxTransform(false);
    });

    window.addEventListener('mouseup', () => {
        if (!zoomIsDragging) return;
        zoomIsDragging = false;
        clampZoomBounds();
        applyLightboxTransform(true);
    });

    img.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        handleDoubleTapZoom(e.clientX, e.clientY);
    });
}

function setLightboxBackgroundInert(active) {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    if (active) {
        lightboxInertState = Array.from(document.body.children)
            .filter(element => {
                if (element === lightbox) return false;
                const tag = element.tagName;
                if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CANVAS' || tag === 'NOSCRIPT') return false;
                return true;
            })
            .map(element => ({ element, wasInert: Boolean(element.inert) }));

        lightboxInertState.forEach(({ element }) => {
            try {
                element.inert = true;
            } catch (_) {}
        });
        return;
    }

    lightboxInertState.forEach(({ element, wasInert }) => {
        try {
            if (element.isConnected) element.inert = wasInert;
        } catch (_) {}
    });
    lightboxInertState = [];
}

function getLightboxFocusableElements(lightbox) {
    return Array.from(lightbox.querySelectorAll(
        'button:not([disabled]), video[controls], [href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => {
        const style = window.getComputedStyle(element);
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
    });
}

function isLightboxVideoUrl(url) {
    try {
        const parsed = new URL(url);
        return /\.(mp4|mov|webm|ogg|m4v|quicktime)$/i.test(parsed.pathname) || parsed.pathname.includes('/video');
    } catch (error) {
        return false;
    }
}

function openLightbox(src) {
    const safeSrc = typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(src) : '';
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    const fallback = document.getElementById('lightbox-fallback');
    const downloadBtn = document.getElementById('lightbox-download-btn');
    const openBtn = document.getElementById('lightbox-open-btn');
    if (!safeSrc || !lightbox || !img || !video) return;

    // 初始化缩放引擎事件监听
    initLightboxZoomHandlers();
    resetLightboxZoom(false);

    if (!lightbox.classList.contains('show')) {
        lightboxPreviousFocus = document.activeElement;
        lightboxPreviousBodyOverflow = document.body.style.overflow;
        setLightboxBackgroundInert(true);
        document.body.style.overflow = 'hidden';
    }
    lightbox.inert = false;
    img.style.display = 'none';
    img.removeAttribute('src');
    if (fallback) fallback.style.display = 'none';
    video.pause();
    video.style.display = 'none';
    video.removeAttribute('src');
    video.load();

    if (isLightboxVideoUrl(safeSrc)) {
        const cleanVideoSrc = safeSrc.replace(/#t=[\d.]+.*$/, '');
        video.src = cleanVideoSrc;
        video.preload = 'auto';
        video.currentTime = 0;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.style.display = 'block';
        video.load();

        video.onerror = () => {
            console.warn('[Lightbox] 视频加载失败，可能是当前浏览器不支持该视频编码 (如苹果 MOV/HEVC):', cleanVideoSrc);
            if (fallback) {
                if (downloadBtn) {
                    downloadBtn.href = cleanVideoSrc;
                    downloadBtn.setAttribute('download', cleanVideoSrc.split('/').pop() || 'video.mp4');
                }
                if (openBtn) {
                    openBtn.href = cleanVideoSrc;
                }
                fallback.style.display = 'block';
            }
            if (typeof showToast === 'function') {
                showToast('该视频格式在当前浏览器无法直接播放，已提供下载/原片查看通道', 4500);
            }
        };

        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {});
        }
    } else {
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = safeSrc;
        img.style.display = 'block';
        resetLightboxZoom(false);
    }
    lightbox.classList.add('show');
    lightbox.setAttribute('aria-hidden', 'false');
    const closeButton = document.getElementById('lightbox-close');
    (closeButton || lightbox).focus({ preventScroll: true });
}

function closeLightbox(event) {
    if (event && event.target && (event.target.id === 'lightbox-video' || event.target.closest('#lightbox-fallback'))) return;
    if (event?.target?.id === 'lightbox-close') event.stopPropagation();

    // 如果在放大状态下点击图片本身，先恢复为原尺寸
    if (event && event.target && event.target.id === 'lightbox-img' && zoomScale > 1.05) {
        resetLightboxZoom(true);
        return;
    }

    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    const fallback = document.getElementById('lightbox-fallback');
    if (!lightbox || !lightbox.classList.contains('show')) return;

    lightbox.classList.remove('show');
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.inert = true;
    if (fallback) {
        fallback.style.display = 'none';
    }
    if (video) {
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.style.display = 'none';
    }
    if (img) {
        resetLightboxZoom(false);
        // 释放图片解码占用的 GPU 纹理与 RAM 位图
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.removeAttribute('src');
        img.style.display = 'none';
    }
    setLightboxBackgroundInert(false);
    document.body.style.overflow = lightboxPreviousBodyOverflow;
    lightboxPreviousBodyOverflow = '';

    if (lightboxPreviousFocus && typeof lightboxPreviousFocus.focus === 'function') {
        lightboxPreviousFocus.focus({ preventScroll: true });
    }
    lightboxPreviousFocus = null;
}

document.addEventListener('keydown', event => {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox?.classList.contains('show')) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
        return;
    }

    if (event.key === 'Tab') {
        const focusable = getLightboxFocusableElements(lightbox);
        if (!focusable.length) {
            event.preventDefault();
            lightbox.focus({ preventScroll: true });
            return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
});
