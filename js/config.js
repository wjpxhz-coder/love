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
const R2_STORAGE_URL = 'https://media.xiaoxi666.kdns.fr';
const SUPABASE_HOST = new URL(SUPABASE_URL).hostname;
const R2_STORAGE_HOST = new URL(R2_STORAGE_URL).hostname;
const TRUSTED_MEDIA_HOSTS = new Set([
    window.location.hostname,
    SUPABASE_HOST,
    R2_STORAGE_HOST
]);
const STORAGE_REFERENCE_PREFIX = 'storage://photos/';
const signedMediaUrlCache = new Map();
const SIGNED_MEDIA_SESSION_PREFIX = 'love_r2_signed_media_';

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
 * 生产媒体只允许 HTTPS 的当前站点、Cloudflare R2 媒体域或本项目 Supabase 域；本地预览可显式允许 blob:。
 */
function sanitizeMediaUrl(value, { allowBlob = false } = {}) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, window.location.href);
        if (allowBlob && url.protocol === 'blob:') return url.href;

        // 自动将遗留的 Supabase photos 存储地址无缝重写至 Cloudflare R2 边缘域名
        if (url.protocol === 'https:' && url.hostname === SUPABASE_HOST
            && /^\/storage\/v1\/object\/(?:(?:sign|public|authenticated)\/)?photos\//i.test(url.pathname)) {
            url.hostname = R2_STORAGE_HOST;
            url.port = '';
        }

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
        const urlMatch = trimmed.match(/\/storage\/v1\/object\/(?:(?:sign|public)\/)?photos\/(.+?)(?:\?.*)?$/i);
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
    if (!objectPath) return '';
    const cachedUrl = getCachedSignedMediaUrl(objectPath);
    if (cachedUrl) return cachedUrl;

    if (!currentAuthUser) {
        return sanitizeMediaUrl(`${R2_STORAGE_URL}/storage/v1/object/photos/${objectPath}`) || '';
    }
    const requestUserId = currentAuthUser.id;
    const requestAuthEpoch = typeof authEpoch === 'number' ? authEpoch : null;

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
    const canonicalFallback = sanitizeMediaUrl(`${R2_STORAGE_URL}/storage/v1/object/photos/${objectPath}`);
    return canonicalFallback || '';
}

/**
 * 批量高效解析媒体签名地址，结合会话持久缓存将网络往返降至最低。
 */
async function batchResolveMediaUrls(values) {
    if (!Array.isArray(values) || values.length === 0) return [];
    if (!currentAuthUser || !supabaseClient) {
        return values.map(val => {
            if (typeof val !== 'string') return '';
            const direct = sanitizeMediaUrl(val);
            if (direct) return direct;
            const objPath = getStorageObjectPath(val);
            if (!objPath) return '';
            const cachedUrl = getCachedSignedMediaUrl(objPath);
            if (cachedUrl) return cachedUrl;
            return sanitizeMediaUrl(`${R2_STORAGE_URL}/storage/v1/object/photos/${objPath}`) || '';
        }).filter(Boolean);
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
        return sanitizeMediaUrl(`${R2_STORAGE_URL}/storage/v1/object/photos/${objPath}`) || '';
    });
}

async function hydrateStructuredMediaContent(rawContent) {
    try {
        const parsed = JSON.parse(rawContent);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawContent;
        const rawImagesList = Array.isArray(parsed.images) ? [...parsed.images] : [];
        const resolvedImagesMap = new Map();
        if (rawImagesList.length > 0) {
            const resolvedList = await batchResolveMediaUrls(rawImagesList);
            rawImagesList.forEach((rawRef, idx) => {
                if (rawRef && resolvedList[idx]) {
                    resolvedImagesMap.set(rawRef, resolvedList[idx]);
                    const objPath = typeof extractStorageObjectPath === 'function' ? extractStorageObjectPath(rawRef) : '';
                    if (objPath) resolvedImagesMap.set(objPath, resolvedList[idx]);
                }
            });
            parsed.images = resolvedList.filter(Boolean);
        }
        if (parsed.audio) parsed.audio = await resolveMediaUrl(parsed.audio);
        if (parsed.video_posters && typeof parsed.video_posters === 'object') {
            const entries = Object.entries(parsed.video_posters);
            const posterRefs = entries.map(([_, p]) => p);
            const resolvedPosters = await batchResolveMediaUrls(posterRefs);
            const hydratedPosters = {};
            entries.forEach(([videoRef, _], idx) => {
                const resolvedPoster = resolvedPosters[idx];
                if (resolvedPoster) {
                    hydratedPosters[videoRef] = resolvedPoster;
                    const videoObjPath = typeof extractStorageObjectPath === 'function' ? extractStorageObjectPath(videoRef) : '';
                    if (videoObjPath) {
                        hydratedPosters[videoObjPath] = resolvedPoster;
                    }
                    const mappedVideoUrl = resolvedImagesMap.get(videoRef) || (videoObjPath && resolvedImagesMap.get(videoObjPath));
                    if (mappedVideoUrl) {
                        hydratedPosters[mappedVideoUrl] = resolvedPoster;
                    }
                }
            });
            parsed.video_posters = hydratedPosters;
        }
        if (parsed.image_thumbnails && typeof parsed.image_thumbnails === 'object') {
            const entries = Object.entries(parsed.image_thumbnails);
            const thumbRefs = entries.map(([_, t]) => t);
            const resolvedThumbs = await batchResolveMediaUrls(thumbRefs);
            const hydratedThumbs = {};
            entries.forEach(([imgRef, _], idx) => {
                const resolvedThumb = resolvedThumbs[idx];
                if (resolvedThumb) {
                    hydratedThumbs[imgRef] = resolvedThumb;
                    const imgObjPath = typeof extractStorageObjectPath === 'function' ? extractStorageObjectPath(imgRef) : '';
                    if (imgObjPath) {
                        hydratedThumbs[imgObjPath] = resolvedThumb;
                    }
                    const mappedImgUrl = resolvedImagesMap.get(imgRef) || (imgObjPath && resolvedImagesMap.get(imgObjPath));
                    if (mappedImgUrl) {
                        hydratedThumbs[mappedImgUrl] = resolvedThumb;
                    }
                }
            });
            parsed.image_thumbnails = hydratedThumbs;
        }

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
                    if (parsed.video_posters && typeof parsed.video_posters === 'object') {
                        Object.values(parsed.video_posters).forEach(p => {
                            if (p) allMediaValues.push(p);
                        });
                    }
                    if (parsed.image_thumbnails && typeof parsed.image_thumbnails === 'object') {
                        Object.values(parsed.image_thumbnails).forEach(t => {
                            if (t) allMediaValues.push(t);
                        });
                    }

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
            if (key && (key.startsWith(SIGNED_MEDIA_SESSION_PREFIX) || key.startsWith('love_signed_media_'))) {
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
                video_posters: (parsed.video_posters && typeof parsed.video_posters === 'object') ? parsed.video_posters : {},
                image_thumbnails: (parsed.image_thumbnails && typeof parsed.image_thumbnails === 'object') ? parsed.image_thumbnails : {},
                audio: typeof parsed.audio === 'string' ? parsed.audio : null,
                is_milestone: Boolean(parsed.is_milestone)
            };
        }
    } catch (_e) {}
    return { text: String(rawContent || ''), images: [], audio: null, is_milestone: false };
}


/**
 * 获取当前登录用户在指定子目录（如 moments、topics）下的安全存储路径前缀。
 */
function getSpaceStorageDirectory(subFolder = 'moments') {
    const spaceId = currentUserProfile && String(currentUserProfile.space_id || '');
    const userId = currentAuthUser && String(currentAuthUser.id || '');
    const safeFolder = String(subFolder || '').trim();
    const isSafeSegment = value => /^[A-Za-z0-9_-]+$/.test(value);
    if (!isSafeSegment(spaceId) || !isSafeSegment(userId) || !isSafeSegment(safeFolder)) return '';
    return `${spaceId}/${userId}/${safeFolder}`;
}

/**
 * 安全提取文件的小写字母数字扩展名。
 */
function getSafeFileExtension(file, fallback = 'bin') {
    const nameExtension = String(file && file.name || '').split('.').pop().toLowerCase();
    if (/^[a-z0-9]{1,8}$/.test(nameExtension)) return nameExtension;
    const typeExtension = String(file && file.type || '').split('/').pop().split(';')[0].toLowerCase();
    return /^[a-z0-9]{1,8}$/.test(typeExtension) ? typeExtension : fallback;
}

/**
 * 统一提取存储路径、去重并清理 photos 桶中的文件。
 */
async function removeStorageObjects(pathsOrRefs) {
    if (!Array.isArray(pathsOrRefs) || !pathsOrRefs.length || !supabaseClient) return;
    const paths = pathsOrRefs
        .map(val => extractStorageObjectPath(val))
        .filter(Boolean);
    if (!paths.length) return;
    const uniquePaths = Array.from(new Set(paths));
    try {
        const { error } = await supabaseClient.storage.from('photos').remove(uniquePaths);
        if (error) console.error('清理存储媒体失败:', error);
    } catch (err) {
        console.error('清理存储媒体异常:', err);
    }
}

function encodeStorageObjectPath(objectPath) {
    return String(objectPath || '')
        .replace(/^\/+/, '')
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/');
}

async function getR2AuthHeaders(extraHeaders = {}) {
    let token = '';
    try {
        if (supabaseClient && supabaseClient.auth) {
            const { data } = await supabaseClient.auth.getSession();
            token = data?.session?.access_token || '';
        }
    } catch (_e) {}
    const headers = { ...extraHeaders };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Cloudflare R2 媒体存储桶适配器（兼容 @supabase/storage-js 的 photos 桶契约）。
 */
function createR2PhotosBucketAdapter() {
    return {
        async upload(path, file, options = {}) {
            try {
                const cleanPath = String(path || '').replace(/^\/+/, '');
                if (!cleanPath) {
                    return { data: null, error: new Error('Invalid storage path') };
                }
                const contentType = options.contentType
                    || (file && file.type)
                    || 'application/octet-stream';
                const headers = await getR2AuthHeaders({
                    'Content-Type': contentType,
                    'x-upsert': String(Boolean(options.upsert))
                });
                const resp = await fetch(`${R2_STORAGE_URL}/storage/v1/object/photos/${encodeStorageObjectPath(cleanPath)}`, {
                    method: 'POST',
                    headers,
                    body: file
                });
                const payload = await resp.json().catch(() => ({}));
                if (!resp.ok) {
                    return {
                        data: null,
                        error: new Error(payload.message || payload.error || `R2 upload failed (${resp.status})`)
                    };
                }
                return {
                    data: {
                        path: cleanPath,
                        id: payload.Id || cleanPath,
                        fullPath: payload.Key || `photos/${cleanPath}`
                    },
                    error: null
                };
            } catch (err) {
                return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
            }
        },

        async createSignedUrl(path, expiresIn = 3600) {
            try {
                const cleanPath = String(path || '').replace(/^\/+/, '');
                if (!cleanPath) {
                    return { data: null, error: new Error('Invalid storage path') };
                }
                const headers = await getR2AuthHeaders({
                    'Content-Type': 'application/json'
                });
                const resp = await fetch(`${R2_STORAGE_URL}/storage/v1/object/sign/photos/${encodeStorageObjectPath(cleanPath)}`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ expiresIn })
                });
                const payload = await resp.json().catch(() => ({}));
                if (!resp.ok || !payload.signedUrl) {
                    return {
                        data: null,
                        error: new Error(payload.error || `R2 sign failed (${resp.status})`)
                    };
                }
                return {
                    data: { signedUrl: payload.signedUrl, signedURL: payload.signedURL },
                    error: null
                };
            } catch (err) {
                return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
            }
        },

        async createSignedUrls(paths, expiresIn = 3600) {
            try {
                if (!Array.isArray(paths) || paths.length === 0) {
                    return { data: [], error: null };
                }
                const headers = await getR2AuthHeaders({
                    'Content-Type': 'application/json'
                });
                const resp = await fetch(`${R2_STORAGE_URL}/storage/v1/object/sign/photos`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ paths, expiresIn })
                });
                const payload = await resp.json().catch(() => null);
                if (!resp.ok || !Array.isArray(payload)) {
                    return {
                        data: null,
                        error: new Error((payload && payload.error) || `R2 batch sign failed (${resp.status})`)
                    };
                }
                return { data: payload, error: null };
            } catch (err) {
                return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
            }
        },

        async remove(paths) {
            try {
                if (!Array.isArray(paths) || paths.length === 0) {
                    return { data: [], error: null };
                }
                const headers = await getR2AuthHeaders({
                    'Content-Type': 'application/json'
                });
                const resp = await fetch(`${R2_STORAGE_URL}/storage/v1/object/photos`, {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({ prefixes: paths })
                });
                const payload = await resp.json().catch(() => null);
                if (!resp.ok) {
                    return {
                        data: null,
                        error: new Error((payload && payload.error) || `R2 delete failed (${resp.status})`)
                    };
                }
                return { data: Array.isArray(payload) ? payload : [], error: null };
            } catch (err) {
                return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
            }
        },

        getPublicUrl(path) {
            const cleanPath = String(path || '').replace(/^\/+/, '');
            return {
                data: {
                    publicUrl: `${R2_STORAGE_URL}/storage/v1/object/public/photos/${encodeStorageObjectPath(cleanPath)}`
                }
            };
        }
    };
}

const supabaseClient = window.supabase?.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: (...args) => fetch(...args) }
    })
    : null;

if (supabaseClient && supabaseClient.storage && typeof supabaseClient.storage.from === 'function') {
    const nativeStorageFrom = supabaseClient.storage.from.bind(supabaseClient.storage);
    const r2PhotosAdapter = createR2PhotosBucketAdapter();
    supabaseClient.storage.from = function(bucketId) {
        if (bucketId === 'photos') {
            return r2PhotosAdapter;
        }
        return nativeStorageFrom(bucketId);
    };
}

window.R2_STORAGE_URL = R2_STORAGE_URL;
window.extractStorageObjectPath = extractStorageObjectPath;
window.getSpaceStorageDirectory = getSpaceStorageDirectory;
window.getSafeFileExtension = getSafeFileExtension;
window.removeStorageObjects = removeStorageObjects;

// ── 版本与更新日志 ──
const APP_VERSION = 'v4.0.2';
const CONFIG = {
    version: 'v4.0.2',
    date: '2026-10-30',
    title: '感情助手 AI 动态极速点评与全流程进度反馈升级 🌸⚡',
    features: [
        'AI 动态分析极速响应：支持卡片已加载画面零延迟直取、多图智能均匀抽样与并行上传，评论区实时展示分析进度并自动高亮定位最新 AI 点评 🤖💖',
        'AI 读图全面修复：打通 Cloudflare R2 动态图片与 AI 临时输入桶桥接，彻底解决新动态 AI 分析及日记选图报「图片不存在」问题 🌸📸',
        '九宫格缩略图与视频流零耗损海报化：上传多图生成轻量微缩图、列表零拉取视频流与全屏秒开 ⚡📸',
        '视频播放修复：恢复原生首帧嗅探与 Range 分段流畅播放，彻底根除九宫格黑屏假死与未登录媒体洗空缺陷 🎬⚡',
        '边缘流媒体适配：全量兼容 .mov/.mp4 双模式，无缝降级原片下载与移动端防阻断自动静音起播 🛡️',
        '存储架构平稳运行：基于 Cloudflare R2 全球边缘存储，零出口流量费用、离线秒开 ☁️💖',
        '存储架构升级：全量 209 个相册与视频媒体无缝迁移至 Cloudflare R2，零出口流量限制、全球边缘极速加载 ☁️⚡',
        '全栈安全加固：升级相册存储桶与动态编辑 RLS 细粒度权限，登出自动彻底擦除私密状态与媒体缓存 🛡️',
        '手账体验全面进化：支持 Agnes AI 温柔智囊、增量无闪烁消息流、多图灯箱左右滑动及发送异常自动回滚 💌',
        '夜间模式与视觉打磨：深紫星空玻璃拟态全面适配，移动端顶栏与安全区防遮挡深度优化 🌙',
        '极致性能与高甜互动：Service Worker 离线缓存路径修复与后台静默热更新，支持双人同频共振特效 ⚡💓',
        '修复手账详情页路由生命周期响应与发送消息按钮点击无反应的问题 💌',
        '完善手账会话认证预加载与弱网状态提示，优化发送拦截与按钮状态自愈 ⚡',
        '恋爱话题手账目录：像日记目录一样分专题交流，再也不用把严肃沟通和日常聊天混在一起 📖',
        '解决方案与共识便签：聊完可一键标记「达成共识」，写下双方约定，高光置顶随时重温 🤝',
        '丰富多媒体支持：支持随时发送文字、精美照片九宫格与语音录音条 🎙️📸'
    ]
};
const UPDATE_LOG = CONFIG;
