// ==========================================
// 1. 配置区
// ==========================================
let isCanvasScrolling = false;
let canvasScrollTimeout;
window.addEventListener('scroll', () => {
    isCanvasScrolling = true;
    clearTimeout(canvasScrollTimeout);
    canvasScrollTimeout = setTimeout(() => {
        isCanvasScrolling = false;
    }, 150);
}, { passive: true });

const startDate = new Date(2026, 4, 23, 1, 0, 0);

// ── 账号系统 ──
// 合法用户名列表（密码验证已迁移到服务端）
const VALID_USERS = ["小蛇", "小奚"];

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

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: (...args) => fetch(...args) }
});

// ── 版本与更新日志 ──
const APP_VERSION = 'v3.1.0';
const UPDATE_LOG = {
    version: 'v3.1.0',
    date: '2026-07-11',
    title: '空间甜蜜升级 💖',
    features: [
        '新增「声音录制」：可以在发布动态时录制并分享你们的专属语音啦 🎙️',
        '新增「版本更新通知」：每次空间升级后，登录时即可查看最新功能 💝',
        '优化「页面性能与体验」：修复了部分设备上按钮遮挡与排版问题 ✨'
    ]
};

