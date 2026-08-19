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

/**
 * 批量高效解析媒体签名地址，将多次网络往返聚合为单次批量接口调用。
 */
async function batchResolveMediaUrls(values) {
    if (!Array.isArray(values) || values.length === 0) return [];
    if (!currentAuthUser || !supabaseClient) {
        return values.map(v => sanitizeMediaUrl(v)).filter(Boolean);
    }

    const requestUserId = currentAuthUser.id;
    const requestAuthEpoch = typeof authEpoch === 'number' ? authEpoch : null;
    const now = Date.now();
    const uncachedPaths = new Set();

    values.forEach(val => {
        if (typeof val !== 'string' || !val.trim()) return;
        const direct = sanitizeMediaUrl(val);
        if (direct) return;
        const objPath = getStorageObjectPath(val);
        if (!objPath) return;
        const cached = signedMediaUrlCache.get(objPath);
        if (!cached || cached.expiresAt <= now) {
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
                                signedMediaUrlCache.set(item.path, {
                                    url: sanitized,
                                    expiresAt: Date.now() + 50 * 60 * 1000
                                });
                            }
                        }
                    });
                }
            }
        } catch (err) {
            console.error('批量创建媒体签名地址失败:', err);
        }
    }

    // 回填解析结果
    return values.map(val => {
        if (typeof val !== 'string') return '';
        const direct = sanitizeMediaUrl(val);
        if (direct) return direct;
        const objPath = getStorageObjectPath(val);
        if (!objPath) return '';
        const cached = signedMediaUrlCache.get(objPath);
        return (cached && cached.expiresAt > Date.now()) ? cached.url : '';
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

// ── 版本与更新日志 ──
const APP_VERSION = 'v3.9.7';
const UPDATE_LOG = {
    version: 'v3.9.7',
    date: '2026-08-19',
    title: '架构重构与代码质量飞跃 🛠️✨',
    features: [
        '核心认证与会话状态基础设施统一，各模块解耦稳健运行 🔐',
        '系统设置与主题控制模块化拆分，提升代码内聚与可维护性 🎨',
        '修复回忆盲盒定位时光轴后的分页光标状态，滑动浏览更流畅 🎲',
        '优化全局动效与大文件处理超时机制，体验更丝滑 💫'
    ]
};



