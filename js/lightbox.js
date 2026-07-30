// --- 灯箱 ---
let lightboxPreviousFocus = null;
let lightboxPreviousBodyOverflow = '';
let lightboxInertState = [];

function setLightboxBackgroundInert(active) {
    const lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    if (active) {
        lightboxInertState = Array.from(document.body.children)
            .filter(element => element !== lightbox && element.tagName !== 'SCRIPT')
            .map(element => ({ element, wasInert: element.inert }));
        lightboxInertState.forEach(({ element }) => {
            element.inert = true;
        });
        return;
    }

    lightboxInertState.forEach(({ element, wasInert }) => {
        if (element.isConnected) element.inert = wasInert;
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
        return /\.(mp4|mov|webm|ogg)$/i.test(parsed.pathname) || parsed.pathname.includes('/video');
    } catch (error) {
        return false;
    }
}

function openLightbox(src) {
    const safeSrc = typeof sanitizeMediaUrl === 'function' ? sanitizeMediaUrl(src) : '';
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (!safeSrc || !lightbox || !img || !video) return;

    if (!lightbox.classList.contains('show')) {
        lightboxPreviousFocus = document.activeElement;
        lightboxPreviousBodyOverflow = document.body.style.overflow;
        setLightboxBackgroundInert(true);
        document.body.style.overflow = 'hidden';
    }
    lightbox.inert = false;
    img.style.display = 'none';
    img.removeAttribute('src');
    video.pause();
    video.style.display = 'none';
    video.removeAttribute('src');
    video.load();

    if (isLightboxVideoUrl(safeSrc)) {
        video.src = safeSrc;
        video.style.display = 'block';
    } else {
        img.src = safeSrc;
        img.style.display = 'block';
    }
    lightbox.classList.add('show');
    lightbox.setAttribute('aria-hidden', 'false');
    const closeButton = document.getElementById('lightbox-close');
    (closeButton || lightbox).focus({ preventScroll: true });
}

function closeLightbox(event) {
    if (event && event.target && event.target.id === 'lightbox-video') return;
    if (event?.target?.id === 'lightbox-close') event.stopPropagation();
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (!lightbox || !lightbox.classList.contains('show')) return;

    lightbox.classList.remove('show');
    lightbox.setAttribute('aria-hidden', 'true');
    lightbox.inert = true;
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.style.display = 'none';
    }
    if (img) {
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
