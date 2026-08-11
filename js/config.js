// ==========================================
// 1. 配置区
// ==========================================
const startDate = new Date(2026, 4, 23, 1, 0, 0);

// 当前登录用户的 profile
let currentUserProfile = null;

const PAGE_SIZE = 10;
let currentPage = 0;
let isLoading = false;
let hasMore = true;


const ANNIVERSARIES = [
    { name: '在一起', icon: '💑', month: 5,  day: 23 },
    { name: '小奚生日', icon: '🎂', month: 7,  day: 11 },
    { name: '小蛇生日', icon: '🎂', month: 8,  day: 15 },
];

const SUPABASE_URL = 'https://tveiegolbotlqpjpwpes.supabase.co';
const SUPABASE_KEY = 'sb_publishable_AhdN1U9vSR1efN_5zDYMLQ_D_fyt3gN';
const TRUSTED_MEDIA_HOSTS = new Set([
    window.location.hostname,
    new URL(SUPABASE_URL).hostname
]);
const STORAGE_REFERENCE_PREFIX = 'storage://photos/';
const signedMediaUrlCache = new Map();

/**
 * 将数据库中的媒体地址收敛到受信任来源。
 * 生产媒体只允许 HTTPS 的当前站点或本项目 Supabase 域；本地预览可显式允许 blob:。
 */
function sanitizeMediaUrl(value, { allowBlob = false } = {}) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, window.location.href);
        if (allowBlob && url.protocol === 'blob:') return url.href;

        const isLocalDevelopment = url.hostname === window.location.hostname
            && (url.protocol === 'http:' || url.protocol === 'https:');
        const isTrustedHttps = url.protocol === 'https:' && TRUSTED_MEDIA_HOSTS.has(url.hostname);
        return isLocalDevelopment || isTrustedHttps ? url.href : '';
    } catch (_error) {
        return '';
    }
}

function createStorageReference(objectPath) {
    if (typeof objectPath !== 'string') return '';
    const normalizedPath = objectPath.replace(/^\/+/, '');
    if (!normalizedPath || normalizedPath.includes('..') || normalizedPath.includes('\\')) return '';
    return `${STORAGE_REFERENCE_PREFIX}${normalizedPath}`;
}

function getStorageObjectPath(value) {
    if (typeof value !== 'string' || !value.startsWith(STORAGE_REFERENCE_PREFIX)) return '';
    const objectPath = value.slice(STORAGE_REFERENCE_PREFIX.length);
    if (!objectPath || objectPath.includes('..') || objectPath.includes('\\')) return '';
    return objectPath;
}

async function resolveMediaUrl(value) {
    const directUrl = sanitizeMediaUrl(value);
    if (directUrl) return directUrl;

    const objectPath = getStorageObjectPath(value);
    if (!objectPath || !currentAuthUser) return '';
    const requestUserId = currentAuthUser.id;
    const requestAuthEpoch = typeof authEpoch === 'number' ? authEpoch : null;
    const cached = signedMediaUrlCache.get(objectPath);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const { data, error } = await supabaseClient.storage
        .from('photos')
        .createSignedUrl(objectPath, 60 * 60);
    if (!currentAuthUser || currentAuthUser.id !== requestUserId
        || (requestAuthEpoch !== null && authEpoch !== requestAuthEpoch)) {
        return '';
    }
    if (error || !data?.signedUrl) {
        console.error('创建媒体签名地址失败:', error);
        return '';
    }

    const signedUrl = sanitizeMediaUrl(data.signedUrl);
    if (signedUrl) {
        signedMediaUrlCache.set(objectPath, {
            url: signedUrl,
            expiresAt: Date.now() + 50 * 60 * 1000
        });
    }
    return signedUrl;
}

async function hydrateStructuredMediaContent(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawContent;
        if (Array.isArray(parsed.images)) {
            parsed.images = (await Promise.all(parsed.images.map(resolveMediaUrl))).filter(Boolean);
        }
        if (parsed.audio) parsed.audio = await resolveMediaUrl(parsed.audio);
        return JSON.stringify(parsed);
    } catch (_error) {
        return rawContent;
    }
}

async function hydrateMomentMediaRecord(record) {
    if (!record || typeof record !== 'object') return record;
    const hydrated = { ...record };
    if (hydrated.type === 'photo' || hydrated.type === 'audio') {
        hydrated.content = await resolveMediaUrl(hydrated.content);
    } else if (hydrated.type === 'moment') {
        hydrated.content = await hydrateStructuredMediaContent(hydrated.content);
    }
    return hydrated;
}

function clearSignedMediaCache() {
    signedMediaUrlCache.clear();
}

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: (...args) => fetch(...args) }
    })
    : null;

// ── 版本与更新日志 ──
const APP_VERSION = 'v3.9.4';
const UPDATE_LOG = {
    version: 'v3.9.4',
    date: '2026-08-11',
    title: '桃花雨加量提速 🌸',
    features: [
        '日历格现在会显示当天最新的简略打卡内容 📝',
        '保留双方心情表情、记录数量和完整详情入口 💞',
        '长内容自动省略，手机和电脑上都能轻松浏览 ✨',
        '主页桃花雨换成更真实的花瓣、花朵与少量蝴蝶 🌸',
        '深浅主题与双方在线彩蛋拥有更自然的颜色层次 ✨',
        '优化高刷新率、移动端和全屏页面下的动画性能 🦋',
        '大事记精简为更清晰、更好浏览的事件时间轴 ⌛',
        '点击大事件可直接回到对应动态，旧动态也能准确定位 📍',
        '桃花数量明显增加并加快飘落，画面更丰盛、更有流动感 🌸'
    ]
};

