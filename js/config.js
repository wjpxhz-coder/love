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
const SIGNED_MEDIA_SESSION_PREFIX = 'love_signed_media_';

function getCachedSignedMediaUrl(objectPath) {
    if (!objectPath) return '';
    const now = Date.now();
    // 1. 检查内存 Map
    const memCached = signedMediaUrlCache.get(objectPath);
    if (memCached && memCached.expiresAt > now) {
        return memCached.url;
    }
    // 2. 检查 sessionStorage
    try {
        const raw = sessionStorage.getItem(SIGNED_MEDIA_SESSION_PREFIX + objectPath);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.url === 'string' && parsed.expiresAt > now) {
                signedMediaUrlCache.set(objectPath, parsed);
                return parsed.url;
            } else {
                sessionStorage.removeItem(SIGNED_MEDIA_SESSION_PREFIX + objectPath);
            }
        }
    } catch (_e) {}
    return '';
}

function setCachedSignedMediaUrl(objectPath, signedUrl, ttlMs = 50 * 60 * 1000) {
    if (!objectPath || !signedUrl) return;
    const entry = {
        url: signedUrl,
        expiresAt: Date.now() + ttlMs
    };
    signedMediaUrlCache.set(objectPath, entry);
    try {
        sessionStorage.setItem(SIGNED_MEDIA_SESSION_PREFIX + objectPath, JSON.stringify(entry));
    } catch (_e) {}
}

/**
 * 将数据库中的媒体地址收敛到受信任来源。
 * 生产媒体只允许 HTTPS 的当前站点或本项目 Supabase 域；本地预览可显式允许 blob:。
 */
function sanitizeMediaUrl(value, { allowBlob = false } = {}) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, window.location.href);
        if (allowBlob && url.protocol === 'blob:') return url.href;

        const isLocalDevelopment = (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
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

function extractStorageObjectPath(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    let objectPath = '';
    if (typeof STORAGE_REFERENCE_PREFIX === 'string' && trimmed.startsWith(STORAGE_REFERENCE_PREFIX)) {
        objectPath = trimmed.slice(STORAGE_REFERENCE_PREFIX.length);
    } else {
        const urlMatch = trimmed.match(/\/storage\/v1\/object\/(?:public\/)?photos\/(.+?)(?:\?.*)?$/i);
        if (urlMatch) {
            objectPath = decodeURIComponent(urlMatch[1]);
        } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('blob:') && !trimmed.startsWith('data:')) {
            objectPath = trimmed.replace(/^\/+/, '');
        }
    }
    if (!objectPath || objectPath.includes('..') || objectPath.includes('\\')) return '';
    if (objectPath.startsWith('avatars/') || objectPath.includes('/avatars/')) return '';
    return objectPath;
}

async function resolveMediaUrl(value) {
    const directUrl = sanitizeMediaUrl(value);
    if (directUrl) return directUrl;

    const objectPath = getStorageObjectPath(value);
    if (!objectPath || !currentAuthUser) return '';
    const requestUserId = currentAuthUser.id;
    const requestAuthEpoch = typeof authEpoch === 'number' ? authEpoch : null;
    const cachedUrl = getCachedSignedMediaUrl(objectPath);
    if (cachedUrl) return cachedUrl;

    try {
        const { data, error } = await supabaseClient.storage
            .from('photos')
            .createSignedUrl(objectPath, 60 * 60);
        if (!currentAuthUser || currentAuthUser.id !== requestUserId
            || (requestAuthEpoch !== null && authEpoch !== requestAuthEpoch)) {
            return '';
        }
        if (!error && data?.signedUrl) {
            const signedUrl = sanitizeMediaUrl(data.signedUrl);
            if (signedUrl) {
                setCachedSignedMediaUrl(objectPath, signedUrl);
                return signedUrl;
            }
        }
    } catch (err) {
        console.warn('创建媒体签名地址失败，尝试离线/本地缓存降级:', err);
    }

    // 弱网或断网降级：返回规范化路径。若 Service Worker 已在本地 CacheStorage 缓存该文件，将直接离线秒开命中
    const canonicalFallback = sanitizeMediaUrl(`${SUPABASE_URL}/storage/v1/object/photos/${objectPath}`);
    return canonicalFallback || '';
}

/**
 * 批量高效解析媒体签名地址，结合会话持久缓存将网络往返降至最低。
 */
async function batchResolveMediaUrls(values) {
    if (!Array.isArray(values) || values.length === 0) return [];
    if (!currentAuthUser || !supabaseClient) {
        return values.map(v => sanitizeMediaUrl(v)).filter(Boolean);
    }

    const requestUserId = currentAuthUser.id;
    const requestAuthEpoch = typeof authEpoch === 'number' ? authEpoch : null;
    const uncachedPaths = new Set();

    values.forEach(val => {
        if (typeof val !== 'string' || !val.trim()) return;
        const direct = sanitizeMediaUrl(val);
        if (direct) return;
        const objPath = getStorageObjectPath(val);
        if (!objPath) return;
        const cachedUrl = getCachedSignedMediaUrl(objPath);
        if (!cachedUrl) {
            uncachedPaths.add(objPath);
        }
    });

    if (uncachedPaths.size > 0) {
        const pathList = Array.from(uncachedPaths);
        try {
            const { data, error } = await supabaseClient.storage
                .from('photos')
                .createSignedUrls(pathList, 60 * 60);

            if (currentAuthUser && currentAuthUser.id === requestUserId
                && (requestAuthEpoch === null || authEpoch === requestAuthEpoch)) {
                if (!error && Array.isArray(data)) {
                    data.forEach(item => {
                        if (item && item.path && item.signedUrl) {
                            const sanitized = sanitizeMediaUrl(item.signedUrl);
                            if (sanitized) {
                                setCachedSignedMediaUrl(item.path, sanitized);
                            }
                        }
                    });
                }
            }
        } catch (err) {
            console.warn('批量创建媒体签名地址失败，尝试离线降级:', err);
        }
    }

    // 回填解析结果：优先使用有效签名，弱网或离线时回退为规范化路径以命中 Service Worker 本地缓存
    return values.map(val => {
        if (typeof val !== 'string') return '';
        const direct = sanitizeMediaUrl(val);
        if (direct) return direct;
        const objPath = getStorageObjectPath(val);
        if (!objPath) return '';
        const cached = getCachedSignedMediaUrl(objPath);
        if (cached) return cached;
        return sanitizeMediaUrl(`${SUPABASE_URL}/storage/v1/object/photos/${objPath}`) || '';
    });
}

async function hydrateStructuredMediaContent(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawContent;
        if (Array.isArray(parsed.images) && parsed.images.length > 0) {
            parsed.images = (await batchResolveMediaUrls(parsed.images)).filter(Boolean);
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

/**
 * 批量为多条动态记录解析所有媒体地址，极大减少列表加载延迟。
 */
async function batchHydrateMomentMediaRecords(records) {
    if (!Array.isArray(records) || records.length === 0) return records || [];
    
    // 收集这一批次全部需要签名的媒体路径
    const allMediaValues = [];
    records.forEach(rec => {
        if (!rec || typeof rec !== 'object') return;
        if (rec.type === 'photo' || rec.type === 'audio') {
            if (rec.content) allMediaValues.push(rec.content);
        } else if (rec.type === 'moment' && typeof rec.content === 'string') {
            try {
                const parsed = JSON.parse(rec.content);
                if (parsed && typeof parsed === 'object') {
                    if (Array.isArray(parsed.images)) allMediaValues.push(...parsed.images);
                    if (parsed.audio) allMediaValues.push(parsed.audio);
                }
            } catch (_e) {}
        }
    });

    if (allMediaValues.length > 0) {
        await batchResolveMediaUrls(allMediaValues);
    }

    return Promise.all(records.map(rec => hydrateMomentMediaRecord(rec)));
}

function clearSignedMediaCache() {
    signedMediaUrlCache.clear();
    try {
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith(SIGNED_MEDIA_SESSION_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (_e) {}
}

/**
 * 统一安全解析动态内容（支持兼容旧版纯文本/照片/音频及新版结构化 JSON）。
 */
function parseMomentPayload(rawContent, type) {
    if (type === 'photo') {
        return { text: '', images: rawContent ? [rawContent] : [], audio: null, is_milestone: false };
    }
    if (type === 'audio') {
        return { text: '', images: [], audio: rawContent || null, is_milestone: false };
    }
    if (type === 'text') {
        return { text: String(rawContent || ''), images: [], audio: null, is_milestone: false };
    }
    try {
        const parsed = JSON.parse(rawContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                text: typeof parsed.text === 'string' ? parsed.text : '',
                images: Array.isArray(parsed.images) ? parsed.images.filter(Boolean) : [],
                audio: typeof parsed.audio === 'string' ? parsed.audio : null,
                is_milestone: Boolean(parsed.is_milestone)
            };
        }
    } catch (_e) {}
    return { text: String(rawContent || ''), images: [], audio: null, is_milestone: false };
}


const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: (...args) => fetch(...args) }
    })
    : null;

window.extractStorageObjectPath = extractStorageObjectPath;

// ── 版本与更新日志 ──
const APP_VERSION = 'v3.9.72';
const CONFIG = {
    version: 'v3.9.72',
    date: '2026-10-04',
    title: '全站极致性能优化与流畅度全面跃升 🚀✨💖',
    features: [
        '首屏网络渲染链路深度优化：彻底消除阻塞脚本与外部字体挂起，首屏呈现飞速秒开 ⚡',
        '图形渲染与 GPU 能效革新：合并移动端全屏绘制图层，滚动自适应限频，彻底消除发热与掉帧 🌸',
        '重度毛玻璃与合成层解耦：移动端优化 GPU 回读多重采样开销，滑动满帧丝滑 💨',
        '数据链路去瀑布化：时间轴数据与收藏状态并行秒开，彻底打破多层网络串行等待 ⏱️',
        '九宫格多图真·按需加载：超过 9 张的折叠照片延迟加载，节省巨额带宽与连接池 📸',
        '登录并发风暴治理：后台维护与离屏监听延后调度，优先极速呈现回忆时光轴 💌'
    ]
};
const UPDATE_LOG = CONFIG;




