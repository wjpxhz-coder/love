// --- 灯箱 ---
let lightboxPreviousFocus = null;
let lightboxPreviousBodyOverflow = '';
let lightboxInertState = [];

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

    // 暂停后台樱花及粒子 Canvas 动画，彻底消除移动端 GPU/显存叠加开销
    if (window.homeSakuraEffect?.setSuspended) {
        window.homeSakuraEffect.setSuspended(true);
    }
    if (typeof pauseProfileParticles === 'function') {
        pauseProfileParticles();
    }

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
    }
    lightbox.classList.add('show');
    lightbox.setAttribute('aria-hidden', 'false');
    const closeButton = document.getElementById('lightbox-close');
    (closeButton || lightbox).focus({ preventScroll: true });
}

function closeLightbox(event) {
    if (event && event.target && (event.target.id === 'lightbox-video' || event.target.closest('#lightbox-fallback'))) return;
    if (event?.target?.id === 'lightbox-close') event.stopPropagation();
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
        // 释放图片解码占用的 GPU 纹理与 RAM 位图
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        img.removeAttribute('src');
        img.style.display = 'none';
    }
    setLightboxBackgroundInert(false);
    document.body.style.overflow = lightboxPreviousBodyOverflow;
    lightboxPreviousBodyOverflow = '';

    // 恢复后台樱花及粒子 Canvas 动画
    if (window.homeSakuraEffect?.setSuspended) {
        window.homeSakuraEffect.setSuspended(false);
    }
    if (typeof profileParticlesRequested !== 'undefined' && profileParticlesRequested && typeof startProfileParticles === 'function') {
        startProfileParticles();
    }

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
