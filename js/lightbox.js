// --- 灯箱 ---
let lightboxPreviousFocus = null;

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

    lightboxPreviousFocus = document.activeElement;
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
    lightbox.focus({ preventScroll: true });
}

function closeLightbox(event) {
    if (event && event.target && event.target.id === 'lightbox-video') return;
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (!lightbox) return;

    lightbox.classList.remove('show');
    lightbox.setAttribute('aria-hidden', 'true');
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
    if (lightboxPreviousFocus && typeof lightboxPreviousFocus.focus === 'function') {
        lightboxPreviousFocus.focus({ preventScroll: true });
    }
    lightboxPreviousFocus = null;
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.getElementById('lightbox')?.classList.contains('show')) {
        closeLightbox();
    }
});
