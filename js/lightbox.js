// --- 灯箱与 iOS 相册级手势缩放/切换/下拉关闭引擎 ---
let lightboxPreviousFocus = null;
let lightboxPreviousBodyOverflow = '';
let lightboxInertState = [];
let lightboxCloseCleanupTimer = null;
let lightboxRenderGeneration = 0;

const LIGHTBOX_IOS_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const LIGHTBOX_CLOSE_MS = 250;

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
let justHandledDoubleTap = false;
let hadMultiTouchInGesture = false;
let zoomMouseMoved = false;
let suppressNextLightboxClick = false;
let zoomHandlersAttached = false;
let videoGestureHandlersAttached = false;
let pendingLightboxSwipeCommit = null;

// 画廊与移动端滑动/下拉关闭手势状态变量
let lightboxGallery = [];
let lightboxCurrentIndex = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
let touchLastY = 0;
let touchLastTime = 0;
let touchVelocityY = 0;
let isSwipeActive = false;
let isDismissDragging = false;
let dismissDragDx = 0;
let dismissDragDy = 0;

function lightboxPrefersReducedMotion() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getLightboxChromeElements() {
    return [
        document.getElementById('lightbox-close'),
        document.getElementById('lightbox-prev'),
        document.getElementById('lightbox-next'),
        document.getElementById('lightbox-counter')
    ].filter(Boolean);
}

function setLightboxChromeOpacity(value, animate = false) {
    getLightboxChromeElements().forEach(el => {
        if (value === '') {
            el.style.transition = animate ? `opacity 200ms ${LIGHTBOX_IOS_EASE}` : '';
            el.style.opacity = '';
        } else {
            el.style.transition = animate ? `opacity 200ms ${LIGHTBOX_IOS_EASE}` : 'none';
            el.style.opacity = String(value);
        }
    });
}

function applyLightboxTransform(animate = false) {
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    img.style.transition = animate && !lightboxPrefersReducedMotion()
        ? `transform 280ms ${LIGHTBOX_IOS_EASE}, opacity 220ms ease`
        : 'none';
    img.style.transform = `translate3d(${zoomTranslateX}px, ${zoomTranslateY}px, 0) scale(${zoomScale})`;
    img.style.cursor = zoomScale > 1.05
        ? (zoomIsDragging ? 'var(--cursor-grabbing)' : 'var(--cursor-grab)')
        : 'var(--cursor-zoom-in)';
}

function resetLightboxZoom(animate = false) {
    zoomScale = 1;
    zoomTranslateX = 0;
    zoomTranslateY = 0;
    zoomIsPinching = false;
    zoomIsDragging = false;
    isSwipeActive = false;
    isDismissDragging = false;
    dismissDragDx = 0;
    dismissDragDy = 0;
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
        const imgRect = img
            ? img.getBoundingClientRect()
            : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
        const centerX = imgRect.left + imgRect.width / 2;
        const centerY = imgRect.top + imgRect.height / 2;

        zoomTranslateX = (centerX - clientX) * 1.5;
        zoomTranslateY = (centerY - clientY) * 1.5;
        clampZoomBounds();
        applyLightboxTransform(true);
    }
}

function resetDismissVisuals(animate = true) {
    const lightbox = document.getElementById('lightbox');
    if (lightbox) {
        lightbox.style.transition = animate ? `background-color 260ms ${LIGHTBOX_IOS_EASE}, opacity 240ms ease` : '';
        lightbox.style.backgroundColor = '';
    }
    setLightboxChromeOpacity('', animate);
    resetLightboxZoom(animate);
}

function settlePendingLightboxSwipeCommit(executeAction = false) {
    if (!pendingLightboxSwipeCommit) return;
    const pending = pendingLightboxSwipeCommit;
    pendingLightboxSwipeCommit = null;
    clearTimeout(pending.timerId);
    if (executeAction && typeof pending.action === 'function') {
        pending.action();
    }
}

function commitLightboxSwipeSwitch(direction, activeEl, currentOffsetX = 0) {
    settlePendingLightboxSwipeCommit(false);
    const goSwitch = () => {
        if (direction === 'next') lightboxNext();
        else lightboxPrev();
    };
    if (!activeEl || lightboxPrefersReducedMotion()) {
        goSwitch();
        return;
    }

    const generation = lightboxRenderGeneration;
    const exitShift = direction === 'next' ? -96 : 96;
    const targetX = (Number(currentOffsetX) || 0) + exitShift;

    activeEl.style.transition = 'transform 125ms cubic-bezier(0.22, 1, 0.36, 1), opacity 115ms ease';
    activeEl.style.transform = `translate3d(${targetX.toFixed(1)}px, 0, 0) scale(0.95)`;
    activeEl.style.opacity = '0';

    const action = () => {
        if (generation !== lightboxRenderGeneration) return;
        const lightbox = document.getElementById('lightbox');
        if (!lightbox?.classList.contains('show')) return;
        goSwitch();
    };
    const timerId = setTimeout(() => {
        pendingLightboxSwipeCommit = null;
        action();
    }, 125);

    pendingLightboxSwipeCommit = { timerId, action };
}

function initLightboxZoomHandlers() {
    if (zoomHandlersAttached) return;
    const img = document.getElementById('lightbox-img');
    if (!img) return;
    zoomHandlersAttached = true;

    // ── 手机端触摸手势（双指捏合缩放、双击放大、单指平移、左右跟手切图、下拉跟手关闭） ──
    img.addEventListener('touchstart', (e) => {
        if (pendingLightboxSwipeCommit) {
            settlePendingLightboxSwipeCommit(true);
        }
        if (zoomSingleTapTimeout) {
            clearTimeout(zoomSingleTapTimeout);
            zoomSingleTapTimeout = null;
        }

        if (e.touches.length >= 2) {
            hadMultiTouchInGesture = true;
            justHandledDoubleTap = false;
            zoomIsPinching = true;
            zoomIsDragging = false;
            isSwipeActive = false;
            isDismissDragging = false;
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

            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchStartTime = now;
            touchLastY = touch.clientY;
            touchLastTime = now;
            touchVelocityY = 0;
            isSwipeActive = false;
            isDismissDragging = false;
            dismissDragDx = 0;
            dismissDragDy = 0;

            if (timeDiff < 320 && distDiff < 36) {
                zoomLastTapTime = 0;
                if (e.cancelable) e.preventDefault();
                handleDoubleTapZoom(touch.clientX, touch.clientY);
                justHandledDoubleTap = true;
                return;
            }
            justHandledDoubleTap = false;
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
            return;
        }
        if (zoomIsDragging && e.touches.length === 1 && zoomScale > 1.05) {
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - zoomStartX;
            const dy = touch.clientY - zoomStartY;
            zoomTranslateX = zoomLastTranslateX + dx;
            zoomTranslateY = zoomLastTranslateY + dy;
            applyLightboxTransform(false);
            return;
        }
        if (!zoomIsPinching && e.touches.length === 1 && zoomScale <= 1.05) {
            const touch = e.touches[0];
            const dx = touch.clientX - touchStartX;
            const dy = touch.clientY - touchStartY;
            const now = performance.now();
            const dt = Math.max(1, now - touchLastTime);
            const vy = (touch.clientY - touchLastY) / dt;
            touchVelocityY = touchVelocityY * 0.4 + vy * 0.6;
            touchLastY = touch.clientY;
            touchLastTime = now;

            const hasGallery = Array.isArray(lightboxGallery) && lightboxGallery.length > 1;

            // 方向锁定：优先判定下拉关闭 vs 左右切图
            if (!isSwipeActive && !isDismissDragging) {
                if (dy > 10 && Math.abs(dy) > Math.abs(dx) * 1.25) {
                    isDismissDragging = true;
                } else if (hasGallery && Math.abs(dx) > Math.abs(dy) * 1.15 && Math.abs(dx) > 10) {
                    isSwipeActive = true;
                }
            }

            if (isDismissDragging) {
                e.preventDefault();
                const lightbox = document.getElementById('lightbox');
                const clampedDy = Math.max(-40, dy);
                const progress = Math.min(1, Math.max(0, clampedDy / 280));
                const dragScale = 1 - progress * 0.24;
                dismissDragDx = dx * 0.35;
                dismissDragDy = clampedDy;

                img.style.transition = 'none';
                img.style.transform = `translate3d(${dismissDragDx.toFixed(1)}px, ${dismissDragDy.toFixed(1)}px, 0) scale(${dragScale.toFixed(3)})`;
                if (lightbox) {
                    lightbox.style.transition = 'none';
                    lightbox.style.backgroundColor = `rgba(14, 10, 13, ${(0.95 * (1 - progress * 0.72)).toFixed(3)})`;
                }
                setLightboxChromeOpacity(Math.max(0, 1 - progress * 1.8).toFixed(3), false);
            } else if (isSwipeActive && hasGallery) {
                e.preventDefault();
                zoomTranslateX = dx * 0.82;
                const dragProgress = Math.min(1, Math.abs(dx) / (window.innerWidth || 375));
                img.style.transition = 'none';
                img.style.transform = `translate3d(${zoomTranslateX.toFixed(1)}px, 0, 0) scale(${(1 - dragProgress * 0.04).toFixed(3)})`;
            }
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
            if (e.touches.length === 0) {
                hadMultiTouchInGesture = false;
            }
            return;
        }
        if (hadMultiTouchInGesture) {
            if (e.touches.length === 0) {
                hadMultiTouchInGesture = false;
            }
            return;
        }
        if (zoomIsDragging) {
            zoomIsDragging = false;
            clampZoomBounds();
            applyLightboxTransform(true);
            return;
        }

        if (isDismissDragging) {
            isDismissDragging = false;
            if (dismissDragDy > 88 || (touchVelocityY > 0.55 && dismissDragDy > 30)) {
                closeLightbox(null, {
                    fromSwipeDown: true,
                    dx: dismissDragDx,
                    dy: dismissDragDy
                });
            } else {
                resetDismissVisuals(true);
            }
            return;
        }

        if (isSwipeActive && zoomScale <= 1.05 && Array.isArray(lightboxGallery) && lightboxGallery.length > 1) {
            isSwipeActive = false;
            const touch = e.changedTouches[0];
            const dx = touch ? touch.clientX - touchStartX : 0;
            const dy = touch ? touch.clientY - touchStartY : 0;
            const elapsed = performance.now() - touchStartTime;
            const fastSwipe = Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.1 && elapsed < 650;
            const farSwipe = Math.abs(dx) > (window.innerWidth || 375) * 0.25;

            if (fastSwipe || farSwipe) {
                commitLightboxSwipeSwitch(dx < 0 ? 'next' : 'prev', img, zoomTranslateX);
                return;
            }
            zoomTranslateX = 0;
            applyLightboxTransform(true);
            return;
        }

        // 双击第二下抬手：阻止合成 click 且不触发单击关闭定时器
        if (justHandledDoubleTap) {
            justHandledDoubleTap = false;
            if (e.cancelable) e.preventDefault();
            return;
        }

        // 单指轻击检测：未放大状态下轻击延时确认后关闭灯箱
        if (e.changedTouches.length === 1 && zoomScale <= 1.05) {
            const touch = e.changedTouches[0];
            const dist = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
            if (dist < 10) {
                if (e.cancelable) e.preventDefault();
                zoomSingleTapTimeout = setTimeout(() => {
                    zoomSingleTapTimeout = null;
                    closeLightbox();
                }, 260);
            }
        }
    });

    img.addEventListener('touchcancel', () => {
        justHandledDoubleTap = false;
        hadMultiTouchInGesture = false;
        zoomIsPinching = false;
        zoomIsDragging = false;
        isSwipeActive = false;
        if (isDismissDragging) {
            isDismissDragging = false;
            resetDismissVisuals(true);
            return;
        }
        zoomTranslateX = 0;
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
        zoomMouseMoved = false;
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
        if (Math.hypot(dx, dy) > 4) {
            zoomMouseMoved = true;
        }
        zoomTranslateX = zoomLastTranslateX + dx;
        zoomTranslateY = zoomLastTranslateY + dy;
        applyLightboxTransform(false);
    });

    window.addEventListener('mouseup', () => {
        if (!zoomIsDragging) return;
        const didMove = zoomMouseMoved;
        zoomIsDragging = false;
        zoomMouseMoved = false;
        if (didMove) {
            suppressNextLightboxClick = true;
            setTimeout(() => {
                suppressNextLightboxClick = false;
            }, 80);
        }
        clampZoomBounds();
        applyLightboxTransform(true);
    });

    img.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (zoomSingleTapTimeout) {
            clearTimeout(zoomSingleTapTimeout);
            zoomSingleTapTimeout = null;
        }
        handleDoubleTapZoom(e.clientX, e.clientY);
    });
}

function isLightboxVideoInFullscreen(video) {
    return Boolean(
        document.fullscreenElement
        || document.webkitFullscreenElement
        || video?.webkitDisplayingFullscreen
    );
}

function initLightboxVideoGestureHandlers() {
    if (videoGestureHandlersAttached) return;
    const video = document.getElementById('lightbox-video');
    const lightbox = document.getElementById('lightbox');
    if (!video || !lightbox) return;
    videoGestureHandlersAttached = true;

    let vTracking = false;
    let vAborted = false;
    let vStartX = 0;
    let vStartY = 0;
    let vStartTime = 0;
    let vLastY = 0;
    let vLastTime = 0;
    let vVelocityY = 0;
    let vSwipeActive = false;
    let vDismissActive = false;
    let vSwipeDx = 0;
    let vDismissDx = 0;
    let vDismissDy = 0;
    let vOriginIsBackdrop = false;

    const getActiveLightboxMedia = () => {
        const imgEl = document.getElementById('lightbox-img');
        if (video.style.display !== 'none') return video;
        if (imgEl && imgEl.style.display !== 'none') return imgEl;
        return null;
    };

    const resetVideoGestureVisuals = (animate = true) => {
        const mediaEl = getActiveLightboxMedia();
        if (lightbox) {
            lightbox.style.transition = animate ? `background-color 260ms ${LIGHTBOX_IOS_EASE}, opacity 240ms ease` : '';
            lightbox.style.backgroundColor = '';
        }
        setLightboxChromeOpacity('', animate);
        if (mediaEl === video) {
            video.style.transition = animate && !lightboxPrefersReducedMotion()
                ? `transform 260ms ${LIGHTBOX_IOS_EASE}, opacity 220ms ease`
                : 'none';
            video.style.transform = 'translate3d(0, 0, 0) scale(1)';
            video.style.opacity = '1';
        } else if (mediaEl) {
            resetLightboxZoom(animate);
        }
    };

    const onGestureStart = (e, isBackdrop) => {
        if (!lightbox.classList.contains('show') || isLightboxVideoInFullscreen(video)) {
            vTracking = false;
            return;
        }
        if (isBackdrop && e.target !== lightbox) {
            return;
        }
        if (!isBackdrop && zoomScale > 1.05) {
            return;
        }
        if (pendingLightboxSwipeCommit) {
            settlePendingLightboxSwipeCommit(true);
        }

        if (e.touches.length >= 2) {
            vAborted = true;
            vTracking = false;
            suppressNextLightboxClick = true;
            setTimeout(() => { suppressNextLightboxClick = false; }, 140);
            return;
        }
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        if (!isBackdrop) {
            // 保护视频底部原生播放控件与进度条拖拽区，绝不抢占 scrubber 操作
            const rect = video.getBoundingClientRect();
            const bottomSafeHeight = Math.max(84, rect.height * 0.25);
            if (rect.height > 0 && (rect.bottom - touch.clientY) <= bottomSafeHeight) {
                vTracking = false;
                return;
            }
        }

        const now = performance.now();
        vTracking = true;
        vAborted = false;
        vOriginIsBackdrop = isBackdrop;
        vStartX = touch.clientX;
        vStartY = touch.clientY;
        vStartTime = now;
        vLastY = touch.clientY;
        vLastTime = now;
        vVelocityY = 0;
        vSwipeActive = false;
        vDismissActive = false;
        vSwipeDx = 0;
        vDismissDx = 0;
        vDismissDy = 0;
    };

    const onGestureMove = (e) => {
        if (!vTracking || vAborted || isLightboxVideoInFullscreen(video)) return;
        if (e.touches.length !== 1) {
            vAborted = true;
            vTracking = false;
            suppressNextLightboxClick = true;
            setTimeout(() => { suppressNextLightboxClick = false; }, 140);
            if (vDismissActive || vSwipeActive) {
                vDismissActive = false;
                vSwipeActive = false;
                resetVideoGestureVisuals(true);
            }
            return;
        }

        // 若背景边缘手势期间图片已处于放大态，不接管手势
        const activeMedia = getActiveLightboxMedia();
        if (!activeMedia || (activeMedia.id === 'lightbox-img' && zoomScale > 1.05)) {
            vTracking = false;
            return;
        }

        const touch = e.touches[0];
        const dx = touch.clientX - vStartX;
        const dy = touch.clientY - vStartY;
        const now = performance.now();
        const dt = Math.max(1, now - vLastTime);
        const vy = (touch.clientY - vLastY) / dt;
        vVelocityY = vVelocityY * 0.4 + vy * 0.6;
        vLastY = touch.clientY;
        vLastTime = now;

        const hasGallery = Array.isArray(lightboxGallery) && lightboxGallery.length > 1;

        if (!vSwipeActive && !vDismissActive) {
            if (dy > 14 && Math.abs(dy) > Math.abs(dx) * 1.3) {
                vDismissActive = true;
            } else if (hasGallery && Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.25) {
                vSwipeActive = true;
            }
        }

        if (vDismissActive) {
            if (e.cancelable) e.preventDefault();
            const clampedDy = Math.max(-40, dy);
            const progress = Math.min(1, Math.max(0, clampedDy / 280));
            const dragScale = 1 - progress * 0.24;
            vDismissDx = dx * 0.35;
            vDismissDy = clampedDy;

            activeMedia.style.transition = 'none';
            activeMedia.style.transform = `translate3d(${vDismissDx.toFixed(1)}px, ${vDismissDy.toFixed(1)}px, 0) scale(${dragScale.toFixed(3)})`;
            lightbox.style.transition = 'none';
            lightbox.style.backgroundColor = `rgba(14, 10, 13, ${(0.95 * (1 - progress * 0.72)).toFixed(3)})`;
            setLightboxChromeOpacity(Math.max(0, 1 - progress * 1.8).toFixed(3), false);
        } else if (vSwipeActive && hasGallery) {
            if (e.cancelable) e.preventDefault();
            vSwipeDx = dx * 0.82;
            const dragProgress = Math.min(1, Math.abs(dx) / (window.innerWidth || 375));
            activeMedia.style.transition = 'none';
            activeMedia.style.transform = `translate3d(${vSwipeDx.toFixed(1)}px, 0, 0) scale(${(1 - dragProgress * 0.04).toFixed(3)})`;
        }
    };

    const onGestureEnd = (e, cancelled) => {
        if (!vTracking) return;
        vTracking = false;

        if (vAborted || cancelled) {
            if (vDismissActive || vSwipeActive) {
                vDismissActive = false;
                vSwipeActive = false;
                resetVideoGestureVisuals(true);
            }
            return;
        }

        const activeMedia = getActiveLightboxMedia();
        if (vDismissActive) {
            vDismissActive = false;
            if (vOriginIsBackdrop) {
                suppressNextLightboxClick = true;
                setTimeout(() => { suppressNextLightboxClick = false; }, 90);
            }
            if (vDismissDy > 88 || (vVelocityY > 0.55 && vDismissDy > 30)) {
                closeLightbox(null, {
                    fromSwipeDown: true,
                    dx: vDismissDx,
                    dy: vDismissDy
                });
            } else {
                resetVideoGestureVisuals(true);
            }
            return;
        }

        if (vSwipeActive && Array.isArray(lightboxGallery) && lightboxGallery.length > 1) {
            vSwipeActive = false;
            if (vOriginIsBackdrop) {
                suppressNextLightboxClick = true;
                setTimeout(() => { suppressNextLightboxClick = false; }, 90);
            }
            const touch = e.changedTouches?.[0];
            const dx = touch ? touch.clientX - vStartX : vSwipeDx;
            const dy = touch ? touch.clientY - vStartY : 0;
            const elapsed = performance.now() - vStartTime;
            const fastSwipe = Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.1 && elapsed < 650;
            const farSwipe = Math.abs(dx) > (window.innerWidth || 375) * 0.25;

            if (fastSwipe || farSwipe) {
                commitLightboxSwipeSwitch(dx < 0 ? 'next' : 'prev', activeMedia, vSwipeDx);
            } else {
                resetVideoGestureVisuals(true);
            }
        }
    };

    video.addEventListener('touchstart', (e) => onGestureStart(e, false), { passive: true });
    video.addEventListener('touchmove', onGestureMove, { passive: false });
    video.addEventListener('touchend', (e) => onGestureEnd(e, false), { passive: true });
    video.addEventListener('touchcancel', (e) => onGestureEnd(e, true), { passive: true });

    lightbox.addEventListener('touchstart', (e) => onGestureStart(e, true), { passive: true });
    lightbox.addEventListener('touchmove', onGestureMove, { passive: false });
    lightbox.addEventListener('touchend', (e) => onGestureEnd(e, false), { passive: true });
    lightbox.addEventListener('touchcancel', (e) => onGestureEnd(e, true), { passive: true });
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

function preloadAdjacentLightboxImages(currentIndex) {
    if (!Array.isArray(lightboxGallery) || lightboxGallery.length <= 1) return;
    const nextIdx = (currentIndex + 1) % lightboxGallery.length;
    const prevIdx = (currentIndex - 1 + lightboxGallery.length) % lightboxGallery.length;
    [nextIdx, prevIdx].forEach(idx => {
        const src = lightboxGallery[idx];
        if (src && !isLightboxVideoUrl(src)) {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.src = src;
        }
    });
}

function updateLightboxGalleryControls() {
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const counterEl = document.getElementById('lightbox-counter');
    const hasMultiple = Array.isArray(lightboxGallery) && lightboxGallery.length > 1;

    if (counterEl) {
        if (hasMultiple) {
            counterEl.textContent = `${lightboxCurrentIndex + 1} / ${lightboxGallery.length}`;
            counterEl.style.display = 'block';
        } else {
            counterEl.style.display = 'none';
        }
    }
    if (prevBtn) prevBtn.style.display = hasMultiple ? 'flex' : 'none';
    if (nextBtn) nextBtn.style.display = hasMultiple ? 'flex' : 'none';
}

function animateLightboxMediaEnter(mediaEl, mode = 'open', generation = lightboxRenderGeneration) {
    if (!mediaEl || lightboxPrefersReducedMotion()) {
        if (mediaEl) {
            mediaEl.style.transition = '';
            mediaEl.style.opacity = '1';
            mediaEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
        }
        return;
    }

    mediaEl.style.transition = 'none';
    if (mode === 'next') {
        mediaEl.style.opacity = '0';
        mediaEl.style.transform = 'translate3d(42px, 0, 0) scale(0.97)';
    } else if (mode === 'prev') {
        mediaEl.style.opacity = '0';
        mediaEl.style.transform = 'translate3d(-42px, 0, 0) scale(0.97)';
    } else {
        mediaEl.style.opacity = '0';
        mediaEl.style.transform = 'translate3d(0, 14px, 0) scale(0.91)';
    }

    void mediaEl.offsetWidth;
    requestAnimationFrame(() => {
        const lightbox = document.getElementById('lightbox');
        if (generation !== lightboxRenderGeneration || !lightbox?.classList.contains('show')) return;
        const dur = mode === 'open' ? 300 : 250;
        mediaEl.style.transition = `transform ${dur}ms ${LIGHTBOX_IOS_EASE}, opacity ${Math.round(dur * 0.8)}ms ease`;
        mediaEl.style.opacity = '1';
        mediaEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
    });
}

function showLightboxItem(index, transitionMode = 'open') {
    settlePendingLightboxSwipeCommit(false);
    if (!Array.isArray(lightboxGallery) || lightboxGallery.length === 0) return;
    if (index < 0 || index >= lightboxGallery.length) return;

    const generation = ++lightboxRenderGeneration;
    lightboxCurrentIndex = index;
    const safeSrc = lightboxGallery[index];
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    const fallback = document.getElementById('lightbox-fallback');
    const downloadBtn = document.getElementById('lightbox-download-btn');
    const openBtn = document.getElementById('lightbox-open-btn');
    if (!img || !video) return;

    updateLightboxGalleryControls();
    resetLightboxZoom(false);

    img.style.display = 'none';
    img.removeAttribute('src');
    if (fallback) fallback.style.display = 'none';
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.style.display = 'none';

    if (window._lightboxVideoFallbackTimer) {
        clearTimeout(window._lightboxVideoFallbackTimer);
        window._lightboxVideoFallbackTimer = null;
    }

    if (isLightboxVideoUrl(safeSrc)) {
        const cleanVideoSrc = safeSrc.replace(/#t=[\d.]+.*$/, '');

        const triggerFallback = (reason) => {
            if (generation !== lightboxRenderGeneration) return;
            console.warn('[Lightbox] 视频画面不可解码，启用安全降级通道:', reason, cleanVideoSrc);
            video.style.display = 'none';
            if (window._lightboxVideoFallbackTimer) {
                clearTimeout(window._lightboxVideoFallbackTimer);
                window._lightboxVideoFallbackTimer = null;
            }
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
                showToast('当前浏览器暂不支持该视频编码画面，已提供原片下载与新标签页播放', 4500);
            }
        };

        video.onerror = () => triggerFallback('video.onerror (MEDIA_ERR)');
        video.crossOrigin = 'anonymous';
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'metadata';
        video.style.display = 'block';
        animateLightboxMediaEnter(video, transitionMode, generation);

        let hasValidDimensions = false;
        const onMetadata = () => {
            if (generation !== lightboxRenderGeneration) return;
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                hasValidDimensions = true;
                if (window._lightboxVideoFallbackTimer) {
                    clearTimeout(window._lightboxVideoFallbackTimer);
                    window._lightboxVideoFallbackTimer = null;
                }
            } else {
                triggerFallback('videoWidth is 0 (unsupported codec)');
            }
        };

        video.addEventListener('loadedmetadata', onMetadata, { once: true });
        video.addEventListener('canplay', () => {
            if (generation === lightboxRenderGeneration && video.videoWidth > 0) hasValidDimensions = true;
        }, { once: true });

        window._lightboxVideoFallbackTimer = setTimeout(() => {
            if (generation !== lightboxRenderGeneration) return;
            if (!hasValidDimensions && (video.videoWidth === 0 || video.networkState === 3 || video.error)) {
                triggerFallback('timeout: no decoded video dimensions');
            }
        }, 2500);

        video.src = cleanVideoSrc;

        video.muted = false;
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((playErr) => {
                if (generation !== lightboxRenderGeneration) return;
                if (playErr && playErr.name === 'NotAllowedError') {
                    video.muted = true;
                    video.play().catch(() => {});
                }
            });
        }
    } else {
        img.decoding = 'async';
        img.loading = 'eager';
        img.crossOrigin = 'anonymous';
        img.src = safeSrc;
        img.style.display = 'block';
        animateLightboxMediaEnter(img, transitionMode, generation);
        preloadAdjacentLightboxImages(index);
    }
}

function lightboxNext(event) {
    if (event) event.stopPropagation();
    if (!Array.isArray(lightboxGallery) || lightboxGallery.length <= 1) return;
    const nextIndex = (lightboxCurrentIndex + 1) % lightboxGallery.length;
    showLightboxItem(nextIndex, 'next');
}

function lightboxPrev(event) {
    if (event) event.stopPropagation();
    if (!Array.isArray(lightboxGallery) || lightboxGallery.length <= 1) return;
    const prevIndex = (lightboxCurrentIndex - 1 + lightboxGallery.length) % lightboxGallery.length;
    showLightboxItem(prevIndex, 'prev');
}

function cleanupLightboxMediaAfterClose() {
    const lightbox = document.getElementById('lightbox');
    if (lightbox?.classList.contains('show')) return;

    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    const fallback = document.getElementById('lightbox-fallback');
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    const counterEl = document.getElementById('lightbox-counter');

    if (lightbox) {
        lightbox.classList.remove('is-closing');
        lightbox.style.transition = '';
        lightbox.style.backgroundColor = '';
    }
    setLightboxChromeOpacity('', false);

    if (fallback) fallback.style.display = 'none';
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    if (counterEl) counterEl.style.display = 'none';
    lightboxGallery = [];
    lightboxCurrentIndex = 0;

    if (video) {
        video.onerror = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.style.display = 'none';
        video.style.transition = '';
        video.style.transform = '';
        video.style.opacity = '';
    }
    if (img) {
        resetLightboxZoom(false);
        img.style.transition = '';
        img.style.opacity = '';
        // 释放图片解码占用的 GPU 纹理与 RAM 位图
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.removeAttribute('src');
        img.style.display = 'none';
    }
}

function openLightbox(src, options = {}) {
    const safeSrc = typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(src) : '';
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (!safeSrc || !lightbox || !img || !video) return;

    // 若上一次关闭动画尚未清理，立刻取消定时器避免误删新打开的图片
    if (lightboxCloseCleanupTimer) {
        clearTimeout(lightboxCloseCleanupTimer);
        lightboxCloseCleanupTimer = null;
    }
    lightbox.classList.remove('is-closing');
    lightbox.style.transition = '';
    lightbox.style.backgroundColor = '';
    setLightboxChromeOpacity('', false);

    // 解析相册列表
    if (options && Array.isArray(options.gallery) && options.gallery.length > 0) {
        lightboxGallery = options.gallery
            .map(item => (typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(item) : item))
            .filter(Boolean);
        let targetIdx = typeof options.initialIndex === 'number' ? options.initialIndex : -1;
        if (targetIdx < 0 || targetIdx >= lightboxGallery.length) {
            targetIdx = lightboxGallery.indexOf(safeSrc);
            if (targetIdx === -1) targetIdx = 0;
        }
        lightboxCurrentIndex = targetIdx;
    } else {
        lightboxGallery = [safeSrc];
        lightboxCurrentIndex = 0;
    }

    initLightboxZoomHandlers();
    initLightboxVideoGestureHandlers();
    settlePendingLightboxSwipeCommit(false);
    justHandledDoubleTap = false;
    hadMultiTouchInGesture = false;
    zoomMouseMoved = false;
    suppressNextLightboxClick = false;
    resetLightboxZoom(false);

    if (!lightbox.classList.contains('show')) {
        lightboxPreviousFocus = document.activeElement;
        setLightboxBackgroundInert(true);
        if (typeof window.lockBodyScroll === 'function') {
            window.lockBodyScroll('lightbox');
        } else {
            lightboxPreviousBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        if (typeof window.suspendAllAmbientEffects === 'function') {
            window.suspendAllAmbientEffects(true, 'lightbox');
        } else {
            window.homeSakuraEffect?.setSuspended?.(true, 'lightbox');
        }
    }
    lightbox.inert = false;

    showLightboxItem(lightboxCurrentIndex, 'open');

    lightbox.classList.add('show');
    lightbox.setAttribute('aria-hidden', 'false');
    const closeButton = document.getElementById('lightbox-close');
    (closeButton || lightbox).focus({ preventScroll: true });
}

function closeLightbox(event, closeOptions = {}) {
    if (event && suppressNextLightboxClick) {
        suppressNextLightboxClick = false;
        return;
    }
    if (event && event.target && (
        event.target.id === 'lightbox-img' ||
        event.target.id === 'lightbox-video' ||
        event.target.closest('#lightbox-fallback') ||
        event.target.closest('.lightbox-nav-btn') ||
        event.target.closest('.lightbox-counter')
    )) return;
    if (event?.target?.closest?.('#lightbox-close')) event.stopPropagation();

    if (zoomSingleTapTimeout) {
        clearTimeout(zoomSingleTapTimeout);
        zoomSingleTapTimeout = null;
    }

    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (!lightbox || !lightbox.classList.contains('show')) return;

    settlePendingLightboxSwipeCommit(false);
    lightboxRenderGeneration += 1;

    if (lightboxCloseCleanupTimer) {
        clearTimeout(lightboxCloseCleanupTimer);
        lightboxCloseCleanupTimer = null;
    }
    if (window._lightboxVideoFallbackTimer) {
        clearTimeout(window._lightboxVideoFallbackTimer);
        window._lightboxVideoFallbackTimer = null;
    }
    if (video) {
        video.pause();
    }

    const reduced = lightboxPrefersReducedMotion();
    const activeMedia = (video && video.style.display !== 'none') ? video : img;

    // 立刻恢复背景可交互与滚动，同时丝滑播放灯箱退场动画，退场结束后再卸载位图纹理
    lightbox.classList.remove('show');
    lightbox.classList.add('is-closing');
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.inert = true;

    setLightboxBackgroundInert(false);
    if (typeof window.unlockBodyScroll === 'function') {
        window.unlockBodyScroll('lightbox');
    } else {
        document.body.style.overflow = lightboxPreviousBodyOverflow;
        lightboxPreviousBodyOverflow = '';
    }
    if (typeof window.suspendAllAmbientEffects === 'function') {
        window.suspendAllAmbientEffects(false, 'lightbox');
    } else {
        window.homeSakuraEffect?.setSuspended?.(false, 'lightbox');
    }

    if (lightboxPreviousFocus && typeof lightboxPreviousFocus.focus === 'function') {
        lightboxPreviousFocus.focus({ preventScroll: true });
    }
    lightboxPreviousFocus = null;

    if (reduced) {
        cleanupLightboxMediaAfterClose();
        return;
    }

    if (activeMedia && activeMedia.style.display !== 'none') {
        activeMedia.style.transition = `transform ${LIGHTBOX_CLOSE_MS}ms ${LIGHTBOX_IOS_EASE}, opacity 200ms ease`;
        if (closeOptions?.fromSwipeDown) {
            const targetX = Number(closeOptions.dx) || 0;
            const targetY = (Number(closeOptions.dy) || 90) + 120;
            activeMedia.style.transform = `translate3d(${targetX.toFixed(1)}px, ${targetY.toFixed(1)}px, 0) scale(0.76)`;
        } else {
            activeMedia.style.transform = 'translate3d(0, 10px, 0) scale(0.9)';
        }
        activeMedia.style.opacity = '0';
    }
    setLightboxChromeOpacity('0', true);
    lightbox.style.transition = `opacity ${LIGHTBOX_CLOSE_MS}ms ${LIGHTBOX_IOS_EASE}, visibility 0s linear ${LIGHTBOX_CLOSE_MS}ms, background-color ${LIGHTBOX_CLOSE_MS}ms ${LIGHTBOX_IOS_EASE}`;

    lightboxCloseCleanupTimer = setTimeout(() => {
        lightboxCloseCleanupTimer = null;
        cleanupLightboxMediaAfterClose();
    }, LIGHTBOX_CLOSE_MS + 30);
}

document.addEventListener('keydown', event => {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox?.classList.contains('show')) return;

    if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
        return;
    }

    if (event.key === 'ArrowRight') {
        event.preventDefault();
        lightboxNext();
        return;
    }

    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        lightboxPrev();
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
