// --- 灯箱 ---
function openLightbox(src) {
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');
    if (src.match(/\.(mp4|mov|webm|ogg)$/i) || src.includes('video')) {
        img.style.display = 'none';
        video.src = src;
        video.style.display = 'block';
    } else {
        video.style.display = 'none';
        video.pause();
        img.src = src;
        img.style.display = 'block';
    }
    document.getElementById('lightbox').classList.add('show');
}

function closeLightbox(event) {
    if (event && event.target && event.target.id === 'lightbox-video') return;
    document.getElementById('lightbox').classList.remove('show');
    const video = document.getElementById('lightbox-video');
    if (video) video.pause();
}
