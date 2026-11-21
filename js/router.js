(function setupAppRouter(global) {
    'use strict';

    const ROUTER_STATE_KEY = '__sweetDiaryRouter';
    const ROUTER_STATE_VERSION = 1;
    const DEFAULT_TITLE = '甜蜜记';

    const IOS_EASE_NAV = 'cubic-bezier(0.32, 0.72, 0, 1)';
    const IOS_EASE_SHEET = 'cubic-bezier(0.32, 0.72, 0, 1)';
    const IOS_EASE_DECEL = 'cubic-bezier(0.22, 1, 0.36, 1)';

    const TRANSITION_DURATIONS = {
        push: 380,
        pop: 340,
        'sheet-in': 390,
        'sheet-out': 310,
        'tab-forward': 260,
        'tab-backward': 260,
        fade: 240,
        none: 0
    };

    const ROUTE_DEFINITIONS = [
        { id: 'home', pattern: '/', label: '', elementId: null, protected: false, level: 0, presentation: 'root' },
        { id: 'login', pattern: '/login', label: '登录', elementId: 'login-overlay', protected: false, level: 1, presentation: 'sheet' },
        { id: 'moment', pattern: '/moments/new', label: '发布动态', elementId: 'momentModal', protected: true, level: 1, presentation: 'sheet' },
        { id: 'moment', pattern: '/moments/edit/:id', label: '编辑动态', elementId: 'momentModal', protected: true, level: 1, presentation: 'sheet' },
        { id: 'mood', pattern: '/mood/check-in', label: '心情打卡', elementId: 'moodModal', protected: true, level: 2, presentation: 'sheet' },
        { id: 'mood', pattern: '/mood/edit/:id', label: '编辑心情', elementId: 'moodModal', protected: true, level: 2, presentation: 'sheet' },
        { id: 'mood-day', pattern: '/mood/day/:date', label: '心情记录', elementId: 'moodDayModal', protected: true, level: 1, presentation: 'push' },
        { id: 'filter', pattern: '/memories/filter', label: '检索回忆', elementId: 'filterModal', protected: true, level: 1, presentation: 'push' },
        { id: 'blindbox', pattern: '/memories/blind-box', label: '回忆盲盒', elementId: 'blindBoxModal', protected: true, level: 1, presentation: 'push' },
        { id: 'ai', pattern: '/agnes', label: '感情小助手', elementId: 'aiModal', protected: true, level: 1, presentation: 'push' },
        { id: 'ai-chat', pattern: '/agnes/chat', label: '感情小助手', elementId: 'aiModal', protected: true, level: 1, presentation: 'push' },
        { id: 'settings', pattern: '/settings', label: '系统设置', elementId: 'settingsModal', protected: true, level: 2, presentation: 'push' },
        { id: 'milestones', pattern: '/milestones', label: '大事记', elementId: 'milestonesModal', protected: true, level: 1, presentation: 'push' },
        { id: 'topics', pattern: '/topics', label: '恋爱手账', elementId: 'topicsModal', protected: true, level: 1, presentation: 'push' },
        { id: 'topic-detail', pattern: '/topics/:id', label: '话题手账', elementId: 'topicDetailModal', protected: true, level: 2, presentation: 'push' },
        // The static edit route must precede the dynamic author route.
        { id: 'edit-profile', pattern: '/profile/edit', label: '编辑资料', elementId: 'edit-profile-page', protected: true, level: 2, presentation: 'sheet' },
        {
            id: 'profile-moments',
            pattern: '/profile/:author/moments',
            label: '发布的动态',
            elementId: 'profile-moments-page',
            protected: true,
            level: 2,
            presentation: 'push',
            siblingGroup: 'profile-content',
            siblingOrder: 0
        },
        {
            id: 'profile-photos',
            pattern: '/profile/:author/photos',
            label: '上传的照片',
            elementId: 'profile-photos-page',
            protected: true,
            level: 2,
            presentation: 'push',
            siblingGroup: 'profile-content',
            siblingOrder: 1
        },
        { id: 'profile', pattern: '/profile/:author', label: '个人主页', elementId: 'profile-page', protected: true, level: 1, presentation: 'push' }
    ];

    const PAGE_ELEMENT_IDS = Array.from(new Set(
        ROUTE_DEFINITIONS.map(route => route.elementId).filter(Boolean)
    ));
    const GLOBAL_CHROME_IDS = [
        'status-bar-shield',
        'skip-link',
        'main-content',
        'fab-container',
        'app-utility-bar',
        'login-trigger-btn',
        'user-avatar-btn',
        'notification-bell',
        'notification-panel',
        'theme-toggle'
    ];
    const HOME_FLOATING_CHROME_IDS = [
        'fab-container',
        'app-utility-bar',
        'login-trigger-btn',
        'user-avatar-btn',
        'notification-bell',
        'theme-toggle'
    ];

    let initialized = false;
    let initQueued = false;
    let baseTitle = DEFAULT_TITLE;
    let currentRoute = null;
    let currentDepth = 0;
    let currentHistoryHash = '';
    let currentHistoryState = null;
    let lastProcessedHref = '';
    const HOME_SCROLL_STORAGE_KEY = 'sweet_diary_home_scroll_y';
    const ROUTER_STACK_STORAGE_KEY = 'sweet_diary_router_stack';
    let homeScrollY = 0;
    let homeScrollSaveTimer = null;
    try {
        const savedScroll = Number(global.sessionStorage?.getItem(HOME_SCROLL_STORAGE_KEY));
        if (Number.isFinite(savedScroll) && savedScroll > 0) homeScrollY = savedScroll;
    } catch (_e) {}
    let transitionToken = 0;
    let chromeSnapshot = null;
    const routeFocusMemory = new Map();
    const routeStackByDepth = new Map();
    let restoringNavigation = null;
    let pendingBackOptions = null;

    // ── 转场协调与生命周期状态 ──
    let scrimElement = null;
    let activeTransition = null;
    let idleCallbacks = [];
    let lastNativeEdgeSwipeAt = 0;
    let swipeState = null;
    let pendingSwipeCommitCleanup = null;

    function escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function compilePattern(pattern) {
        const keys = [];
        const source = pattern
            .split('/')
            .map(segment => {
                if (!segment.startsWith(':')) return escapeRegExp(segment);
                keys.push(segment.slice(1));
                return '([^/]+)';
            })
            .join('/');
        return { keys, expression: new RegExp(`^${source}$`) };
    }

    ROUTE_DEFINITIONS.forEach(definition => {
        const compiled = compilePattern(definition.pattern);
        definition.keys = compiled.keys;
        definition.expression = compiled.expression;
    });

    function normalizeFullPath(value) {
        let raw = typeof value === 'string' ? value.trim() : '/';
        if (raw.startsWith('#')) raw = raw.slice(1);
        if (!raw.startsWith('/')) raw = `/${raw}`;

        try {
            const parsed = new URL(`https://app-router.invalid${raw}`);
            let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
            if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
            return `${pathname || '/'}${parsed.search}`;
        } catch (_error) {
            return '/';
        }
    }

    function safeDecode(value) {
        try {
            return decodeURIComponent(value);
        } catch (_error) {
            return value;
        }
    }

    function toQueryObject(search) {
        const query = {};
        const searchParams = new URLSearchParams(search);
        searchParams.forEach((value, key) => {
            if (!Object.prototype.hasOwnProperty.call(query, key)) {
                query[key] = value;
            } else if (Array.isArray(query[key])) {
                query[key].push(value);
            } else {
                query[key] = [query[key], value];
            }
        });
        return query;
    }

    function buildRoute(definition, fullPath, pathname, search, match) {
        const params = {};
        definition.keys.forEach((key, index) => {
            params[key] = safeDecode(match[index + 1]);
        });

        let label = definition.label;
        if (definition.id === 'profile' && params.author) {
            label = `${params.author}的主页`;
        } else if (definition.id === 'profile-moments' && params.author) {
            label = `${params.author}发布的动态`;
        } else if (definition.id === 'profile-photos' && params.author) {
            label = `${params.author}上传的照片`;
        }
        return {
            id: definition.id,
            pattern: definition.pattern,
            path: pathname,
            pathname,
            fullPath,
            search,
            query: toQueryObject(search),
            params,
            title: label ? `${label} · ${baseTitle}` : baseTitle,
            elementId: definition.elementId,
            protected: definition.protected,
            level: definition.level ?? (definition.elementId ? 1 : 0),
            presentation: definition.presentation || (definition.elementId ? 'push' : 'root'),
            siblingGroup: definition.siblingGroup || null,
            siblingOrder: definition.siblingOrder ?? 0
        };
    }

    function matchRoute(value) {
        const fullPath = normalizeFullPath(value);
        const queryIndex = fullPath.indexOf('?');
        const pathname = queryIndex === -1 ? fullPath : fullPath.slice(0, queryIndex);
        const search = queryIndex === -1 ? '' : fullPath.slice(queryIndex);

        for (const definition of ROUTE_DEFINITIONS) {
            const match = pathname.match(definition.expression);
            if (match) return buildRoute(definition, fullPath, pathname, search, match);
        }
        return null;
    }

    function copyRoute(route) {
        if (!route) return null;
        const query = {};
        Object.entries(route.query).forEach(([key, value]) => {
            query[key] = Array.isArray(value) ? [...value] : value;
        });
        return {
            ...route,
            params: { ...route.params },
            query
        };
    }

    function readLocation() {
        const hash = global.location.hash;
        if (!hash || hash === '#') {
            return { kind: 'root', route: matchRoute('/'), unknown: false, preserveAnchor: false };
        }
        if (!hash.startsWith('#/')) {
            return { kind: 'anchor', route: matchRoute('/'), unknown: false, preserveAnchor: true };
        }

        const requestedPath = normalizeFullPath(hash.slice(1));
        const route = matchRoute(requestedPath);
        if (route) {
            return { kind: 'app', route, unknown: false, preserveAnchor: false };
        }
        return {
            kind: 'unknown',
            route: matchRoute('/'),
            requestedPath,
            unknown: true,
            preserveAnchor: false
        };
    }

    function routerIsAuthenticated() {
        try {
            return typeof global.isAuthenticated === 'function'
                && Boolean(global.isAuthenticated());
        } catch (error) {
            console.error('读取登录状态失败:', error);
            return false;
        }
    }

    function makeLoginRoute(returnRoute) {
        return matchRoute(`/login?return=${encodeURIComponent(returnRoute.fullPath)}`);
    }

    function resolveLoginReturnRoute(loginRoute) {
        if (loginRoute?.id !== 'login') return matchRoute('/');
        const returnPath = new URLSearchParams(loginRoute.search).get('return');
        if (!returnPath) return matchRoute('/');
        const route = matchRoute(returnPath);
        if (!route || !route.protected || route.id === 'login') return matchRoute('/');
        return route;
    }

    function authorizeRoute(route) {
        if (route.id === 'login' && routerIsAuthenticated()) {
            return {
                route: resolveLoginReturnRoute(route),
                replace: true,
                replaceOnNavigate: true
            };
        }
        if (!route.protected || routerIsAuthenticated()) {
            return { route, replace: false, replaceOnNavigate: false };
        }
        return {
            route: makeLoginRoute(route),
            replace: true,
            replaceOnNavigate: false
        };
    }

    function readRouterState(state = global.history.state) {
        if (!state || typeof state !== 'object') return null;
        const metadata = state[ROUTER_STATE_KEY];
        if (!metadata || metadata.version !== ROUTER_STATE_VERSION) return null;
        if (!Number.isInteger(metadata.depth) || metadata.depth < 0) return null;
        if (typeof metadata.fullPath !== 'string' || typeof metadata.hash !== 'string') return null;
        return metadata;
    }

    function makeHistoryState(baseState, extraState, depth, route, hash) {
        const state = baseState && typeof baseState === 'object' ? { ...baseState } : {};
        if (extraState && typeof extraState === 'object') Object.assign(state, extraState);
        state[ROUTER_STATE_KEY] = {
            version: ROUTER_STATE_VERSION,
            depth,
            fullPath: route.fullPath,
            hash
        };
        return state;
    }

    function routeHash(route) {
        return `#${route.fullPath}`;
    }

    function replaceCurrentHistoryState(route, depth, hash = global.location.hash, extraState) {
        const state = makeHistoryState(
            global.history.state,
            extraState,
            depth,
            route,
            hash
        );
        global.history.replaceState(state, '');
        return state;
    }

    function persistRouteStack() {
        try {
            const serialized = {};
            routeStackByDepth.forEach((route, depth) => {
                if (route?.fullPath) serialized[String(depth)] = route.fullPath;
            });
            global.sessionStorage?.setItem(ROUTER_STACK_STORAGE_KEY, JSON.stringify(serialized));
        } catch (_e) {}
    }

    function hydrateRouteStack() {
        try {
            const raw = global.sessionStorage?.getItem(ROUTER_STACK_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            Object.entries(parsed).forEach(([depthKey, fullPath]) => {
                const depth = Number(depthKey);
                if (!Number.isInteger(depth) || depth < 0 || typeof fullPath !== 'string') return;
                const matched = matchRoute(fullPath);
                if (matched) routeStackByDepth.set(depth, matched);
            });
        } catch (_e) {}
    }

    function recordStackEntry(depth, route, truncateAfter = false) {
        if (truncateAfter) {
            for (const key of Array.from(routeStackByDepth.keys())) {
                if (key > depth) routeStackByDepth.delete(key);
            }
        }
        if (route) routeStackByDepth.set(depth, copyRoute(route));
        persistRouteStack();
    }

    function getFallbackParentRoute(route) {
        if (!route || route.id === 'home') return null;
        if (route.id === 'topic-detail') return matchRoute('/topics');
        if (route.id === 'profile-moments' || route.id === 'profile-photos' || route.id === 'edit-profile') {
            const author = route.params?.author
                || global.currentViewingProfileAuthor
                || global.currentAuthor
                || '';
            if (author) {
                const profileRoute = matchRoute(`/profile/${encodeURIComponent(author)}`);
                if (profileRoute) return profileRoute;
            }
        }
        return matchRoute('/');
    }

    function getPreviousStackRoute() {
        if (!currentRoute || currentRoute.id === 'home') return null;
        if (currentDepth > 0) {
            for (let d = currentDepth - 1; d >= 0; d -= 1) {
                const candidate = routeStackByDepth.get(d);
                if (candidate && candidate.elementId !== currentRoute.elementId) {
                    return copyRoute(candidate);
                }
            }
        }
        return getFallbackParentRoute(currentRoute);
    }

    function prefersReducedMotion() {
        return typeof global.matchMedia === 'function'
            && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function isTouchMobileViewport() {
        return typeof global.matchMedia === 'function'
            && (global.matchMedia('(pointer: coarse)').matches || global.innerWidth <= 768);
    }

    function setElementInert(element, inert) {
        if (!element) return;
        element.inert = inert;
        if (inert) element.setAttribute('inert', '');
        else element.removeAttribute('inert');
    }

    function ensureTransitionScrim() {
        if (scrimElement && scrimElement.isConnected) return scrimElement;
        const existing = document.getElementById('app-transition-scrim');
        if (existing) {
            scrimElement = existing;
            return scrimElement;
        }
        const div = document.createElement('div');
        div.id = 'app-transition-scrim';
        div.className = 'app-transition-scrim';
        div.setAttribute('aria-hidden', 'true');
        document.body.appendChild(div);
        scrimElement = div;
        return scrimElement;
    }

    function getScrimMaxAlpha() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        return isDark ? 0.36 : 0.16;
    }

    function getHomeFloatingElements() {
        return HOME_FLOATING_CHROME_IDS
            .map(id => document.getElementById(id))
            .filter(Boolean);
    }

    function syncHomeViewportOrigin() {
        const main = document.getElementById('main-content');
        if (!main) return;
        const rect = main.getBoundingClientRect();
        const originY = Math.max(0, (global.innerHeight * 0.5) - rect.top);
        main.style.transformOrigin = `50% ${Math.round(originY)}px`;
    }

    function applyScrollbarCompensation(lock) {
        if (!document.documentElement) return;
        if (lock) {
            if (!document.body.classList.contains('app-page-active')) {
                const sbWidth = Math.max(0, global.innerWidth - document.documentElement.clientWidth);
                document.documentElement.style.setProperty('--app-scrollbar-comp', `${sbWidth}px`);
            }
            document.body.classList.add('app-page-active');
        } else {
            document.body.classList.remove('app-page-active', 'app-page-settled');
            document.documentElement.style.setProperty('--app-scrollbar-comp', '0px');
        }
    }

    function resetElementTransitionStyles(element) {
        if (!element) return;
        element.classList.remove(
            'is-leaving',
            'is-ios-front',
            'is-ios-back',
            'is-ios-sheet',
            'is-ios-shadow',
            'is-ios-dragging',
            'is-swipe-underlay'
        );
        element.style.transition = '';
        element.style.transform = '';
        element.style.opacity = '';
        element.style.willChange = '';
        element.style.transformOrigin = '';
        element.style.removeProperty('--ios-shadow-opacity');
    }

    function resetHomeTransitionStyles() {
        const main = document.getElementById('main-content');
        if (main) {
            main.classList.remove('is-ios-home-underlay');
            main.style.transition = '';
            main.style.transform = '';
            main.style.opacity = '';
            main.style.willChange = '';
            main.style.transformOrigin = '';
        }
        getHomeFloatingElements().forEach(el => {
            el.style.transition = '';
            el.style.transform = '';
            el.style.opacity = '';
            el.style.willChange = '';
        });
    }

    function resetScrim() {
        if (!scrimElement) return;
        scrimElement.classList.remove('is-visible');
        scrimElement.style.transition = '';
        scrimElement.style.opacity = '';
    }

    function flushIdleCallbacks() {
        if (!idleCallbacks.length) return;
        const queued = idleCallbacks.splice(0, idleCallbacks.length);
        queued.forEach(fn => {
            try {
                fn();
            } catch (error) {
                console.error('路由过渡完成后回调执行失败:', error);
            }
        });
    }

    function onAppRouteTransitionIdle(callback) {
        if (typeof callback !== 'function') return;
        if (!activeTransition && !swipeState?.active) {
            callback();
            return;
        }
        idleCallbacks.push(callback);
    }

    function isAppRouteTransitioning() {
        return Boolean(activeTransition || swipeState?.active);
    }

    function clearPendingSwipeCommitCleanup() {
        if (!pendingSwipeCommitCleanup) return;
        const cleanup = pendingSwipeCommitCleanup;
        pendingSwipeCommitCleanup = null;
        if (cleanup.timerId) global.clearTimeout(cleanup.timerId);
        if (cleanup.frontEl) {
            resetElementTransitionStyles(cleanup.frontEl);
            if (!cleanup.frontEl.classList.contains('is-active')) {
                cleanup.frontEl.hidden = true;
                setElementInert(cleanup.frontEl, true);
                cleanup.frontEl.setAttribute('aria-hidden', 'true');
            }
        }
        if (cleanup.underlayIsHome) {
            resetHomeTransitionStyles();
        } else if (cleanup.underlayEl) {
            resetElementTransitionStyles(cleanup.underlayEl);
            if (!cleanup.underlayEl.classList.contains('is-active')) {
                cleanup.underlayEl.hidden = true;
                setElementInert(cleanup.underlayEl, true);
                cleanup.underlayEl.setAttribute('aria-hidden', 'true');
            }
        }
        resetScrim();
        document.documentElement.classList.remove('is-route-transitioning');
        global.suspendAllAmbientEffects?.(false, 'route-transition');
    }

    function abortActiveSwipe() {
        const state = swipeState;
        if (!state) return;
        swipeState = null;
        state.aborted = true;
        if (state.rafId) global.cancelAnimationFrame(state.rafId);
        if (state.fallbackTimer) global.clearTimeout(state.fallbackTimer);
        if (state.onEnd && state.frontEl) {
            state.frontEl.removeEventListener('transitionend', state.onEnd);
        }
        resetElementTransitionStyles(state.frontEl);
        if (state.underlayIsHome) {
            resetHomeTransitionStyles();
        } else if (state.underlayEl) {
            resetElementTransitionStyles(state.underlayEl);
            if (!state.underlayEl.classList.contains('is-active')) {
                state.underlayEl.hidden = true;
                setElementInert(state.underlayEl, true);
                state.underlayEl.setAttribute('aria-hidden', 'true');
            }
        }
        resetScrim();
        document.documentElement.classList.remove('is-route-transitioning');
        global.suspendAllAmbientEffects?.(false, 'route-transition');
    }

    function finalizeActiveTransition({ flushCallbacks = true } = {}) {
        const current = activeTransition;
        if (!current) return;
        activeTransition = null;

        if (current.rafId) global.cancelAnimationFrame(current.rafId);
        if (current.timerId) global.clearTimeout(current.timerId);
        if (current.cleanupListener) current.cleanupListener();

        current.elements.forEach(el => {
            resetElementTransitionStyles(el);
            if (el.classList.contains('app-page') && !el.classList.contains('is-active')) {
                el.hidden = true;
                setElementInert(el, true);
                el.setAttribute('aria-hidden', 'true');
            }
        });

        resetHomeTransitionStyles();
        resetScrim();
        document.documentElement.classList.remove('is-route-transitioning');
        global.suspendAllAmbientEffects?.(false, 'route-transition');

        const isHome = !currentRoute || currentRoute.id === 'home';
        if (isHome) {
            applyScrollbarCompensation(false);
        } else {
            document.body.classList.add('app-page-settled');
        }

        if (flushCallbacks) {
            flushIdleCallbacks();
        } else {
            idleCallbacks = [];
        }
    }

    function resolveTransitionSpec(previousRoute, nextRoute, reason, options = {}) {
        if (
            prefersReducedMotion()
            || reason === 'init'
            || !previousRoute
            || options.skipTransition
            || previousRoute.elementId === nextRoute.elementId
        ) {
            return { kind: 'none', duration: 0 };
        }

        // 同级 Tab 切屏（例如 个人动态 <-> 个人照片）
        if (
            previousRoute.siblingGroup
            && nextRoute.siblingGroup
            && previousRoute.siblingGroup === nextRoute.siblingGroup
        ) {
            const forward = (nextRoute.siblingOrder ?? 0) >= (previousRoute.siblingOrder ?? 0);
            const kind = forward ? 'tab-forward' : 'tab-backward';
            return { kind, duration: TRANSITION_DURATIONS[kind] };
        }

        // 通知精确定位回首页或强制回到公开首页时，使用极柔淡出避免定位滚动抖动
        if (reason === 'locate-moment' || reason === 'locate-mood' || reason === 'force-public-home') {
            return { kind: 'fade', duration: TRANSITION_DURATIONS.fade };
        }

        const directionHint = options.direction;
        let isBack = false;
        if (directionHint === 'back') {
            isBack = true;
        } else if (directionHint === 'forward') {
            isBack = false;
        } else if (
            reason === 'back'
            || reason === 'back-fallback'
            || reason === 'swipe-back'
            || reason === 'login-complete'
        ) {
            isBack = true;
        } else if (nextRoute.id === 'home') {
            isBack = true;
        } else if (previousRoute.id === 'home') {
            isBack = false;
        } else if (nextRoute.level < previousRoute.level) {
            isBack = true;
        }

        if (isBack) {
            const kind = previousRoute.presentation === 'sheet' ? 'sheet-out' : 'pop';
            return { kind, duration: TRANSITION_DURATIONS[kind] };
        }

        const kind = nextRoute.presentation === 'sheet' ? 'sheet-in' : 'push';
        return { kind, duration: TRANSITION_DURATIONS[kind] };
    }

    function resetPageInnerScroll(route) {
        if (!route?.elementId) return;
        const page = document.getElementById(route.elementId);
        if (!page) return;
        const scroller = page.querySelector('.app-page-scroll, .profile-body, .edit-body');
        if (scroller && typeof scroller.scrollTo === 'function') {
            scroller.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        } else if (scroller) {
            scroller.scrollTop = 0;
        }
    }

    function applyPageVisibilityInstant(route, options = {}) {
        const nextElementId = route?.elementId || null;
        PAGE_ELEMENT_IDS.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            resetElementTransitionStyles(element);
            const isTarget = nextElementId === id;
            element.classList.toggle('is-active', isTarget);
            element.hidden = !isTarget;
            setElementInert(element, !isTarget);
            element.setAttribute('aria-hidden', String(!isTarget));
        });
        resetHomeTransitionStyles();
        resetScrim();
        document.documentElement.classList.remove('is-route-transitioning');
        global.suspendAllAmbientEffects?.(false, 'route-transition');

        if (!route || route.id === 'home') {
            applyScrollbarCompensation(false);
            if (options.scroll !== false && Math.abs((global.scrollY || 0) - homeScrollY) > 2) {
                scrollToPosition(homeScrollY);
            }
        } else {
            applyScrollbarCompensation(true);
            document.body.classList.add('app-page-settled');
        }
    }

    function runIosRouteTransition(prevRoute, nextRoute, spec, options = {}) {
        const prevIsHome = !prevRoute || prevRoute.id === 'home';
        const nextIsHome = !nextRoute || nextRoute.id === 'home';
        const prevPageEl = prevRoute?.elementId ? document.getElementById(prevRoute.elementId) : null;
        const nextPageEl = nextRoute?.elementId ? document.getElementById(nextRoute.elementId) : null;
        const mainEl = document.getElementById('main-content');
        const floatingChrome = getHomeFloatingElements();
        const scrim = ensureTransitionScrim();
        const maxScrim = getScrimMaxAlpha();
        const isLocateHomeFade = nextIsHome && spec.kind === 'fade' && options.scroll === false;

        // 若目标或旧页面是首页，确保首页立刻恢复可见且滚动位无偏差
        if (prevIsHome || nextIsHome) {
            document.body.classList.remove('app-page-settled');
            if (nextIsHome && options.scroll !== false && Math.abs((global.scrollY || 0) - homeScrollY) > 2) {
                scrollToPosition(homeScrollY);
            }
            syncHomeViewportOrigin();
        }

        // 通知/盲盒精确定位回首页时立即释放滚动锁定，避免 overflow: hidden 阻断 scrollIntoView
        if (isLocateHomeFade) {
            applyScrollbarCompensation(false);
        } else {
            applyScrollbarCompensation(true);
        }

        // 先隐藏所有无关页面，避免残留图层干扰
        PAGE_ELEMENT_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el === prevPageEl || el === nextPageEl) return;
            resetElementTransitionStyles(el);
            el.classList.remove('is-active');
            el.hidden = true;
            setElementInert(el, true);
            el.setAttribute('aria-hidden', 'true');
        });

        // 激活目标页 & 标记离开页
        if (nextPageEl) {
            resetElementTransitionStyles(nextPageEl);
            nextPageEl.classList.add('is-active');
            nextPageEl.hidden = false;
            setElementInert(nextPageEl, false);
            nextPageEl.setAttribute('aria-hidden', 'false');
        }
        if (prevPageEl && prevPageEl !== nextPageEl) {
            resetElementTransitionStyles(prevPageEl);
            prevPageEl.classList.remove('is-active');
            prevPageEl.classList.add('is-leaving');
            prevPageEl.hidden = false;
            setElementInert(prevPageEl, true);
            prevPageEl.setAttribute('aria-hidden', 'true');
        }

        const involvedElements = [];
        if (prevPageEl) involvedElements.push(prevPageEl);
        if (nextPageEl && nextPageEl !== prevPageEl) involvedElements.push(nextPageEl);

        const kind = spec.kind;
        const dur = spec.duration;
        let frontEl = null;
        let backEl = null;
        let primaryListenEl = null;

        document.documentElement.classList.add('is-route-transitioning');
        global.suspendAllAmbientEffects?.(true, 'route-transition');

        // ── 设置起始姿态（transition: none）──
        if (kind === 'push') {
            frontEl = nextPageEl;
            backEl = prevIsHome ? mainEl : prevPageEl;
            primaryListenEl = frontEl || backEl;

            if (frontEl) {
                frontEl.classList.add('is-ios-front', 'is-ios-shadow');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform';
                frontEl.style.transform = 'translate3d(100%, 0, 0)';
                frontEl.style.setProperty('--ios-shadow-opacity', '1');
            }
            if (backEl) {
                if (prevIsHome) backEl.classList.add('is-ios-home-underlay');
                else backEl.classList.add('is-ios-back');
                backEl.style.transition = 'none';
                backEl.style.willChange = 'transform';
                backEl.style.transform = 'translate3d(0, 0, 0)';
            }
            if (prevIsHome) {
                floatingChrome.forEach(el => {
                    el.style.transition = 'none';
                    el.style.willChange = 'transform, opacity';
                    el.style.opacity = '1';
                    el.style.transform = 'translate3d(0, 0, 0)';
                });
            }
            scrim.classList.add('is-visible');
            scrim.style.transition = 'none';
            scrim.style.opacity = '0';
        } else if (kind === 'pop') {
            frontEl = prevPageEl;
            backEl = nextIsHome ? mainEl : nextPageEl;
            primaryListenEl = frontEl || backEl;

            if (frontEl) {
                // 起手临时加 is-ios-dragging 抑制 ::before 过渡，避免 0->1->0 反向缩短在 50ms 提前派发 transitionend
                frontEl.classList.add('is-ios-front', 'is-ios-shadow', 'is-ios-dragging');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform';
                frontEl.style.transform = 'translate3d(0, 0, 0)';
                frontEl.style.setProperty('--ios-shadow-opacity', '1');
            }
            if (backEl) {
                if (nextIsHome) backEl.classList.add('is-ios-home-underlay');
                else backEl.classList.add('is-ios-back');
                backEl.style.transition = 'none';
                backEl.style.willChange = 'transform';
                backEl.style.transform = 'translate3d(-26%, 0, 0)';
            }
            if (nextIsHome) {
                floatingChrome.forEach(el => {
                    el.style.transition = 'none';
                    el.style.willChange = 'transform, opacity';
                    el.style.opacity = '0';
                    el.style.transform = 'translate3d(-16px, 0, 0)';
                });
            }
            scrim.classList.add('is-visible');
            scrim.style.transition = 'none';
            scrim.style.opacity = String(maxScrim);
        } else if (kind === 'sheet-in') {
            frontEl = nextPageEl;
            backEl = prevIsHome ? mainEl : prevPageEl;
            primaryListenEl = frontEl || backEl;

            if (frontEl) {
                frontEl.classList.add('is-ios-front', 'is-ios-sheet');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform';
                frontEl.style.transform = 'translate3d(0, 100%, 0)';
            }
            if (backEl) {
                if (prevIsHome) backEl.classList.add('is-ios-home-underlay');
                else backEl.classList.add('is-ios-back');
                backEl.style.transition = 'none';
                backEl.style.willChange = 'transform';
                backEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
            }
            if (prevIsHome) {
                floatingChrome.forEach(el => {
                    el.style.transition = 'none';
                    el.style.willChange = 'transform, opacity';
                    el.style.opacity = '1';
                    el.style.transform = 'scale(1)';
                });
            }
            scrim.classList.add('is-visible');
            scrim.style.transition = 'none';
            scrim.style.opacity = '0';
        } else if (kind === 'sheet-out') {
            frontEl = prevPageEl;
            backEl = nextIsHome ? mainEl : nextPageEl;
            primaryListenEl = frontEl || backEl;

            if (frontEl) {
                frontEl.classList.add('is-ios-front', 'is-ios-sheet');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform';
                frontEl.style.transform = 'translate3d(0, 0, 0)';
            }
            if (backEl) {
                if (nextIsHome) backEl.classList.add('is-ios-home-underlay');
                else backEl.classList.add('is-ios-back');
                backEl.style.transition = 'none';
                backEl.style.willChange = 'transform';
                backEl.style.transform = 'translate3d(0, 0, 0) scale(0.955)';
            }
            if (nextIsHome) {
                floatingChrome.forEach(el => {
                    el.style.transition = 'none';
                    el.style.willChange = 'transform, opacity';
                    el.style.opacity = '0';
                    el.style.transform = 'scale(0.94)';
                });
            }
            scrim.classList.add('is-visible');
            scrim.style.transition = 'none';
            scrim.style.opacity = String(maxScrim);
        } else if (kind === 'tab-forward' || kind === 'tab-backward') {
            const dir = kind === 'tab-forward' ? 1 : -1;
            frontEl = nextPageEl;
            backEl = prevPageEl;
            primaryListenEl = frontEl || backEl;

            if (frontEl) {
                frontEl.classList.add('is-ios-front');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform, opacity';
                frontEl.style.opacity = '0';
                frontEl.style.transform = `translate3d(${dir * 26}px, 0, 0)`;
            }
            if (backEl) {
                backEl.classList.add('is-ios-back');
                backEl.style.transition = 'none';
                backEl.style.willChange = 'transform, opacity';
                backEl.style.opacity = '1';
                backEl.style.transform = 'translate3d(0, 0, 0)';
            }
        } else if (kind === 'fade') {
            frontEl = nextPageEl || prevPageEl;
            primaryListenEl = frontEl;
            if (nextPageEl) {
                nextPageEl.classList.add('is-ios-front');
                nextPageEl.style.transition = 'none';
                nextPageEl.style.willChange = 'transform, opacity';
                nextPageEl.style.opacity = '0';
                nextPageEl.style.transform = 'scale(0.985)';
            }
            if (prevPageEl && prevPageEl !== nextPageEl) {
                prevPageEl.classList.add(nextPageEl ? 'is-ios-back' : 'is-ios-front');
                prevPageEl.style.transition = 'none';
                prevPageEl.style.willChange = 'transform, opacity';
                prevPageEl.style.opacity = '1';
                prevPageEl.style.transform = 'scale(1)';
            }
        }

        // 单次布局提交，确保浏览器在下一帧能以初始姿态光栅化起跑
        if (primaryListenEl) {
            void primaryListenEl.offsetWidth;
        }

        const record = {
            kind,
            elements: involvedElements,
            rafId: null,
            timerId: null,
            cleanupListener: null
        };
        activeTransition = record;

        const onEnd = event => {
            if (activeTransition !== record) return;
            if (event.pseudoElement) return;
            if (event.target !== primaryListenEl) return;
            const validProp = kind === 'fade'
                ? (event.propertyName === 'opacity' || event.propertyName === 'transform')
                : event.propertyName === 'transform';
            if (!validProp) return;
            finalizeActiveTransition({ flushCallbacks: true });
        };

        if (primaryListenEl) {
            primaryListenEl.addEventListener('transitionend', onEnd);
            record.cleanupListener = () => primaryListenEl.removeEventListener('transitionend', onEnd);
        }

        // 同步层级预先注册防挂起兜底定时器，避免标签页切后台暂停 rAF 导致动画死锁
        record.timerId = global.setTimeout(() => {
            if (activeTransition === record) {
                finalizeActiveTransition({ flushCallbacks: true });
            }
        }, dur + 220);

        record.rafId = global.requestAnimationFrame(() => {
            if (activeTransition !== record) return;
            record.rafId = null;

            const navEasing = kind.startsWith('sheet') ? IOS_EASE_SHEET : IOS_EASE_NAV;

            if (kind === 'push') {
                if (frontEl) {
                    frontEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    frontEl.style.transform = 'translate3d(0, 0, 0)';
                }
                if (backEl) {
                    backEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    backEl.style.transform = 'translate3d(-26%, 0, 0)';
                }
                if (prevIsHome) {
                    floatingChrome.forEach(el => {
                        el.style.transition = `transform ${Math.round(dur * 0.8)}ms ${IOS_EASE_DECEL}, opacity ${Math.round(dur * 0.6)}ms ease`;
                        el.style.opacity = '0';
                        el.style.transform = 'translate3d(-16px, 0, 0)';
                    });
                }
                scrim.style.transition = `opacity ${dur}ms ${navEasing}`;
                scrim.style.opacity = String(maxScrim);
            } else if (kind === 'pop') {
                if (frontEl) {
                    frontEl.classList.remove('is-ios-dragging');
                    frontEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    frontEl.style.transform = 'translate3d(100%, 0, 0)';
                    frontEl.style.setProperty('--ios-shadow-opacity', '0');
                }
                if (backEl) {
                    backEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    backEl.style.transform = 'translate3d(0, 0, 0)';
                }
                if (nextIsHome) {
                    floatingChrome.forEach(el => {
                        el.style.transition = `transform ${dur}ms ${navEasing}, opacity ${Math.round(dur * 0.78)}ms ease`;
                        el.style.opacity = '1';
                        el.style.transform = 'translate3d(0, 0, 0)';
                    });
                }
                scrim.style.transition = `opacity ${dur}ms ${navEasing}`;
                scrim.style.opacity = '0';
            } else if (kind === 'sheet-in') {
                if (frontEl) {
                    frontEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    frontEl.style.transform = 'translate3d(0, 0, 0)';
                }
                if (backEl) {
                    backEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    backEl.style.transform = 'translate3d(0, 0, 0) scale(0.955)';
                }
                if (prevIsHome) {
                    floatingChrome.forEach(el => {
                        el.style.transition = `transform ${Math.round(dur * 0.8)}ms ${IOS_EASE_DECEL}, opacity ${Math.round(dur * 0.55)}ms ease`;
                        el.style.opacity = '0';
                        el.style.transform = 'scale(0.94)';
                    });
                }
                scrim.style.transition = `opacity ${dur}ms ${navEasing}`;
                scrim.style.opacity = String(maxScrim);
            } else if (kind === 'sheet-out') {
                if (frontEl) {
                    frontEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    frontEl.style.transform = 'translate3d(0, 100%, 0)';
                }
                if (backEl) {
                    backEl.style.transition = `transform ${dur}ms ${navEasing}`;
                    backEl.style.transform = 'translate3d(0, 0, 0) scale(1)';
                }
                if (nextIsHome) {
                    floatingChrome.forEach(el => {
                        el.style.transition = `transform ${dur}ms ${navEasing}, opacity ${Math.round(dur * 0.78)}ms ease`;
                        el.style.opacity = '1';
                        el.style.transform = 'scale(1)';
                    });
                }
                scrim.style.transition = `opacity ${dur}ms ${navEasing}`;
                scrim.style.opacity = '0';
            } else if (kind === 'tab-forward' || kind === 'tab-backward') {
                const dir = kind === 'tab-forward' ? 1 : -1;
                if (frontEl) {
                    frontEl.style.transition = `transform ${dur}ms ${IOS_EASE_DECEL}, opacity ${Math.round(dur * 0.85)}ms ease`;
                    frontEl.style.opacity = '1';
                    frontEl.style.transform = 'translate3d(0, 0, 0)';
                }
                if (backEl) {
                    backEl.style.transition = `transform ${dur}ms ${IOS_EASE_DECEL}, opacity ${Math.round(dur * 0.75)}ms ease`;
                    backEl.style.opacity = '0';
                    backEl.style.transform = `translate3d(${-dir * 20}px, 0, 0)`;
                }
            } else if (kind === 'fade') {
                if (nextPageEl) {
                    nextPageEl.style.transition = `transform ${dur}ms ${IOS_EASE_DECEL}, opacity ${dur}ms ease`;
                    nextPageEl.style.opacity = '1';
                    nextPageEl.style.transform = 'scale(1)';
                }
                if (prevPageEl && prevPageEl !== nextPageEl) {
                    prevPageEl.style.transition = `transform ${dur}ms ${IOS_EASE_DECEL}, opacity ${dur}ms ease`;
                    prevPageEl.style.opacity = '0';
                    prevPageEl.style.transform = 'scale(0.985)';
                }
            }

            // 动画正式起跑后刷新为精准兜底定时器
            if (record.timerId) global.clearTimeout(record.timerId);
            record.timerId = global.setTimeout(() => {
                if (activeTransition === record) {
                    finalizeActiveTransition({ flushCallbacks: true });
                }
            }, dur + 95);
        });
    }

    function lockGlobalChrome() {
        if (!chromeSnapshot) {
            chromeSnapshot = new Map();
            GLOBAL_CHROME_IDS.forEach(id => {
                const element = document.getElementById(id);
                if (!element) return;
                chromeSnapshot.set(id, {
                    inert: element.hasAttribute('inert'),
                    ariaHidden: element.getAttribute('aria-hidden')
                });
            });
        }

        GLOBAL_CHROME_IDS.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            setElementInert(element, true);
            element.setAttribute('aria-hidden', 'true');
        });
    }

    function unlockGlobalChrome() {
        GLOBAL_CHROME_IDS.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;

            const previous = chromeSnapshot?.get(id);
            setElementInert(element, Boolean(previous?.inert));
            if (!previous) return;
            if (previous.ariaHidden === null) element.removeAttribute('aria-hidden');
            else element.setAttribute('aria-hidden', previous.ariaHidden);
        });
        chromeSnapshot = null;
    }

    function invokeHook(name, ...args) {
        const hook = global[name];
        if (typeof hook !== 'function') return;
        try {
            const result = hook(...args.map(argument => (
                argument && typeof argument === 'object' && argument.id
                    ? copyRoute(argument)
                    : argument
            )));
            if (result && typeof result.then === 'function') {
                result.catch(error => console.error(`${name} 异步执行失败:`, error));
            }
        } catch (error) {
            console.error(`${name} 执行失败:`, error);
        }
    }

    function canLeaveRoute(nextRoute, reason, options = {}) {
        if (!currentRoute || currentRoute.fullPath === nextRoute.fullPath) return true;
        if (options.skipGuard || options.force) return true;

        const hook = global.canLeaveAppRoute;
        if (typeof hook !== 'function') return true;
        try {
            const result = hook(copyRoute(currentRoute), copyRoute(nextRoute), reason);
            if (result && typeof result.then === 'function') {
                console.warn('canLeaveAppRoute 必须同步返回布尔值；异步结果已按阻止离开处理。');
                return false;
            }
            return result !== false;
        } catch (error) {
            console.error('canLeaveAppRoute 执行失败:', error);
            return false;
        }
    }

    function rememberHomeScroll(forceSync = false) {
        if (currentRoute?.id !== 'home' && !forceSync) return;
        homeScrollY = Math.max(0, global.scrollY || global.pageYOffset || 0);
        if (forceSync) {
            if (homeScrollSaveTimer !== null) {
                global.clearTimeout(homeScrollSaveTimer);
                homeScrollSaveTimer = null;
            }
            try {
                global.sessionStorage?.setItem(HOME_SCROLL_STORAGE_KEY, String(homeScrollY));
            } catch (_e) {}
            return;
        }
        if (homeScrollSaveTimer !== null) {
            global.clearTimeout(homeScrollSaveTimer);
        }
        homeScrollSaveTimer = global.setTimeout(() => {
            homeScrollSaveTimer = null;
            try {
                global.sessionStorage?.setItem(HOME_SCROLL_STORAGE_KEY, String(homeScrollY));
            } catch (_e) {}
        }, 200);
    }

    function setRouterHomeScroll(top) {
        const value = Number(top);
        if (Number.isFinite(value) && value >= 0) {
            homeScrollY = value;
            if (homeScrollSaveTimer !== null) {
                global.clearTimeout(homeScrollSaveTimer);
                homeScrollSaveTimer = null;
            }
            try {
                global.sessionStorage?.setItem(HOME_SCROLL_STORAGE_KEY, String(homeScrollY));
            } catch (_e) {}
        }
    }

    function runOnNextFrame(callback) {
        if (typeof global.requestAnimationFrame === 'function') {
            return global.requestAnimationFrame(callback);
        }
        return global.setTimeout(callback, 0);
    }

    function scrollToPosition(top) {
        try {
            global.scrollTo({ top, left: 0, behavior: 'auto' });
        } catch (_error) {
            global.scrollTo(0, top);
        }
    }

    function findFocusTarget(route) {
        const root = route.elementId
            ? document.getElementById(route.elementId)
            : document.getElementById('main-content');
        if (!root) return null;
        if (root.matches?.('[data-page-focus], h1, h2')) return root;
        return root.querySelector('[data-page-focus]') || root.querySelector('h1, h2');
    }

    function rememberRouteFocus(route) {
        const activeElement = document.activeElement;
        if (!route || !activeElement || activeElement === document.body) return;
        const routeRoot = route.elementId
            ? document.getElementById(route.elementId)
            : document.getElementById('main-content');
        const belongsToRoute = routeRoot?.contains?.(activeElement)
            || GLOBAL_CHROME_IDS.some(id => document.getElementById(id)?.contains?.(activeElement));
        if (belongsToRoute) routeFocusMemory.set(route.fullPath, activeElement);
    }

    function focusRoute(route) {
        const remembered = routeFocusMemory.get(route.fullPath);
        // 防跳顶保护：主页已处于下滚浏览状态且无具体记忆元素时，不强行将焦点转至顶部标题
        if (route.id === 'home' && homeScrollY > 100 && !remembered) {
            return;
        }
        const target = remembered?.isConnected && !remembered.inert
            ? remembered
            : findFocusTarget(route);
        if (!target || typeof target.focus !== 'function') return;

        const addedTabIndex = !target.hasAttribute('tabindex');
        if (addedTabIndex) target.setAttribute('tabindex', '-1');
        try {
            target.focus({ preventScroll: true });
        } catch (_error) {
            target.focus();
        }
        if (addedTabIndex) {
            target.addEventListener('blur', () => {
                if (target.getAttribute('tabindex') === '-1') target.removeAttribute('tabindex');
            }, { once: true });
        }
    }

    function scheduleRouteEntry(route, options = {}) {
        const token = ++transitionToken;
        if (options.preserveAnchor) return;

        if (options.scroll !== false) {
            if (route.id === 'home') {
                if (Math.abs((global.scrollY || 0) - homeScrollY) > 2) {
                    scrollToPosition(homeScrollY);
                }
            } else {
                // 绝不把 window.scrollY 归零，保留底层首页精准滚动位，只归零子页自身滚动容器
                resetPageInnerScroll(route);
            }
        }

        if (options.focus === false) return;
        onAppRouteTransitionIdle(() => {
            if (token !== transitionToken || currentRoute?.fullPath !== route.fullPath) return;
            focusRoute(route);
        });
    }

    function transitionTo(route, reason, options = {}) {
        const previous = currentRoute;
        const changed = !previous || previous.fullPath !== route.fullPath;

        // 立刻打断并归位上一轮未完成的转场或滑返手势（支持快速连点与外部导航零竞态）
        if (pendingSwipeCommitCleanup) {
            clearPendingSwipeCommitCleanup();
        }
        if (swipeState) {
            abortActiveSwipe();
        }
        if (activeTransition) {
            finalizeActiveTransition({ flushCallbacks: false });
        }

        if (previous?.id === 'home' && route.id !== 'home') rememberHomeScroll(true);
        if (changed && previous) rememberRouteFocus(previous);

        // 先更新标题与当前路由指针，确保 onAppRouteEnter 钩子读到的路由准确无误
        const spec = resolveTransitionSpec(previous, route, reason, options);

        if (changed && previous) invokeHook('onAppRouteLeave', previous, route);

        currentRoute = route;
        document.title = route.title;

        if (route.id === 'home') unlockGlobalChrome();
        else lockGlobalChrome();

        // 目标页滚回顶部后再渲染，保证滑入屏幕第一帧即呈完整画面
        if (options.scroll !== false && route.id !== 'home') {
            resetPageInnerScroll(route);
        }

        if (spec.kind === 'none') {
            applyPageVisibilityInstant(route, options);
        } else {
            runIosRouteTransition(previous, route, spec, options);
        }

        if (changed) invokeHook('onAppRouteEnter', route, previous);
        // 若 onAppRouteEnter 内部同步触发了重定向或返回，立刻停止外层收尾避免覆盖新路由
        if (currentRoute !== route) return;

        if (changed || options.forceEntry) scheduleRouteEntry(route, options);

        if (spec.kind === 'none') {
            flushIdleCallbacks();
        }
    }

    function setCurrentHistorySnapshot(depth) {
        currentDepth = depth;
        currentHistoryHash = global.location.hash;
        currentHistoryState = global.history.state;
        lastProcessedHref = global.location.href;
    }

    function restoreRejectedNavigation(incomingDepth) {
        const delta = currentDepth - incomingDepth;
        if (delta !== 0) {
            restoringNavigation = {
                depth: currentDepth,
                hash: currentHistoryHash,
                fullPath: currentRoute.fullPath
            };
            global.history.go(delta);
            return;
        }

        const route = currentRoute;
        const state = makeHistoryState(
            currentHistoryState,
            null,
            currentDepth,
            route,
            currentHistoryHash
        );
        const url = `${global.location.pathname}${global.location.search}${currentHistoryHash}`;
        global.history.replaceState(state, '', url);
        setCurrentHistorySnapshot(currentDepth);
    }

    function handleRestorationEvent() {
        if (!restoringNavigation) return false;
        if (global.location.hash !== restoringNavigation.hash) return true;

        const metadata = readRouterState();
        if (metadata && metadata.depth !== restoringNavigation.depth) return true;
        currentDepth = restoringNavigation.depth;
        currentHistoryHash = global.location.hash;
        currentHistoryState = global.history.state;
        lastProcessedHref = global.location.href;
        restoringNavigation = null;
        return true;
    }

    function handleLocationChange(reason) {
        if (!initialized || handleRestorationEvent()) return;
        if (global.location.href === lastProcessedHref) return;

        const navigationOptions = pendingBackOptions || {};
        pendingBackOptions = null;
        const effectiveReason = navigationOptions.reason || reason;
        const locationInfo = readLocation();
        if (locationInfo.preserveAnchor && currentRoute?.id === 'home') {
            const anchorRoute = currentRoute || locationInfo.route;
            replaceCurrentHistoryState(anchorRoute, currentDepth, global.location.hash);
            setCurrentHistorySnapshot(currentDepth);
            return;
        }
        const metadata = readRouterState();
        const metadataMatchesLocation = Boolean(
            metadata && metadata.hash === global.location.hash
        );
        const previousDepth = currentDepth;
        const incomingDepth = metadataMatchesLocation
            ? metadata.depth
            : currentDepth + 1;

        const authorization = authorizeRoute(locationInfo.route);
        const nextRoute = authorization.route;
        const mustReplaceUrl = locationInfo.unknown || authorization.replace;
        if (!canLeaveRoute(nextRoute, effectiveReason, navigationOptions)) {
            restoreRejectedNavigation(incomingDepth);
            return;
        }

        if (currentRoute?.id === 'home' && nextRoute.id !== 'home') rememberHomeScroll(true);

        if (mustReplaceUrl) {
            const hash = routeHash(nextRoute);
            const state = makeHistoryState(
                global.history.state,
                null,
                incomingDepth,
                nextRoute,
                hash
            );
            global.history.replaceState(state, '', hash);
        } else if (
            !metadataMatchesLocation
            || metadata.fullPath !== nextRoute.fullPath
        ) {
            replaceCurrentHistoryState(nextRoute, incomingDepth);
        }

        setCurrentHistorySnapshot(incomingDepth);
        recordStackEntry(incomingDepth, nextRoute, false);
        if (currentRoute?.fullPath === nextRoute.fullPath) return;

        const direction = incomingDepth < previousDepth
            ? 'back'
            : (incomingDepth > previousDepth ? 'forward' : undefined);

        // 若 iOS Safari 系统自带左边缘滑返刚取消我方 touch 并派发 popstate，避免重复二次滑出动画
        const isProbableNativeEdgePop = reason === 'popstate'
            && !navigationOptions.reason
            && lastNativeEdgeSwipeAt > 0
            && (Date.now() - lastNativeEdgeSwipeAt) < 900;
        if (isProbableNativeEdgePop) {
            lastNativeEdgeSwipeAt = 0;
        }

        transitionTo(nextRoute, effectiveReason, {
            preserveAnchor: locationInfo.preserveAnchor,
            direction,
            skipTransition: Boolean(navigationOptions.skipTransition || isProbableNativeEdgePop)
        });
    }

    function handleRouteEscape(event) {
        if (event.key !== 'Escape' || event.defaultPrevented || currentRoute?.id === 'home') return;
        if (document.getElementById('lightbox')?.classList.contains('show')) return;
        if (document.querySelector('dialog[open]')) return;

        const diaryPicker = document.getElementById('aiDiaryPicker');
        const isAIRoute = currentRoute?.id === 'ai' || currentRoute?.id === 'ai-chat';
        if (
            isAIRoute
            && diaryPicker
            && !diaryPicker.hidden
            && !diaryPicker.classList.contains('is-closing')
        ) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof global.closeAIDiaryPicker === 'function') global.closeAIDiaryPicker();
            return;
        }

        event.preventDefault();
        appBack('/');
    }

    // ── iOS 级移动端左边缘跟手右滑返回手势（Interactive Edge Swipe-Back） ──
    function isNonStandaloneIosBrowser() {
        const ua = global.navigator?.userAgent || '';
        const isIos = /iP(hone|ad|od)/i.test(ua)
            || (global.navigator?.platform === 'MacIntel' && (global.navigator?.maxTouchPoints || 0) > 1);
        if (!isIos) return false;
        const standalone = Boolean(
            global.navigator?.standalone
            || global.matchMedia?.('(display-mode: standalone)')?.matches
        );
        return !standalone;
    }

    function canStartEdgeSwipeBack(touch, target) {
        if (prefersReducedMotion()) return false;
        if (!currentRoute || currentRoute.id === 'home') return false;
        if (currentRoute.presentation !== 'push') return false;
        if (activeTransition || swipeState || pendingSwipeCommitCleanup) return false;
        if (document.getElementById('lightbox')?.classList.contains('show')) return false;
        if (document.querySelector('dialog[open]')) return false;
        const diaryPicker = document.getElementById('aiDiaryPicker');
        if (diaryPicker && !diaryPicker.hidden) return false;

        // 在非 PWA 独立模式的 iOS 浏览器里，0~16px 礼让 Safari 原生边缘滑返避免抢事件；
        // 从 16~44px 或 PWA / Android / 桌面触控 0~34px 由我们接管跟手侧滑
        const iosBrowser = isNonStandaloneIosBrowser();
        if (iosBrowser) {
            if (touch.clientX < 16 || touch.clientX > 44) return false;
        } else if (touch.clientX > 34) {
            return false;
        }
        if (target?.closest?.('input[type="range"], [data-no-swipe-back]')) return false;

        const activePage = currentRoute.elementId ? document.getElementById(currentRoute.elementId) : null;
        if (!activePage || !activePage.classList.contains('is-active')) return false;
        return true;
    }

    function initEdgeSwipeBack() {
        const EDGE_LOCK_THRESHOLD = 8;

        let candidate = null;
        let nativeEdgeTouchPending = false;

        function cancelSwipeVisuals(state) {
            if (!state) return;
            if (state.rafId) global.cancelAnimationFrame(state.rafId);
            resetElementTransitionStyles(state.frontEl);
            if (state.underlayIsHome) {
                resetHomeTransitionStyles();
                if (currentRoute && currentRoute.id !== 'home') {
                    document.body.classList.add('app-page-settled');
                }
            } else if (state.underlayEl) {
                resetElementTransitionStyles(state.underlayEl);
                if (!state.underlayEl.classList.contains('is-active')) {
                    state.underlayEl.hidden = true;
                    setElementInert(state.underlayEl, true);
                    state.underlayEl.setAttribute('aria-hidden', 'true');
                }
            }
            resetScrim();
            document.documentElement.classList.remove('is-route-transitioning');
            global.suspendAllAmbientEffects?.(false, 'route-transition');
        }

        document.addEventListener('touchstart', event => {
            if (event.touches.length !== 1 || swipeState?.settling) {
                candidate = null;
                nativeEdgeTouchPending = false;
                return;
            }
            const touch = event.touches[0];
            nativeEdgeTouchPending = isNonStandaloneIosBrowser() && touch.clientX <= 20;
            if (!canStartEdgeSwipeBack(touch, event.target)) {
                candidate = null;
                return;
            }
            candidate = {
                startX: touch.clientX,
                startY: touch.clientY,
                startTime: performance.now(),
                lastX: touch.clientX,
                lastTime: performance.now(),
                vx: 0,
                locked: false,
                rejected: false
            };
        }, { passive: true });

        document.addEventListener('touchmove', event => {
            if (swipeState?.settling) return;
            if (!candidate || candidate.rejected || event.touches.length !== 1) return;
            const touch = event.touches[0];
            const dx = touch.clientX - candidate.startX;
            const dy = touch.clientY - candidate.startY;

            if (!candidate.locked) {
                if (Math.hypot(dx, dy) < EDGE_LOCK_THRESHOLD) return;
                if (dx <= 4 || dx < Math.abs(dy) * 1.3) {
                    candidate.rejected = true;
                    return;
                }
                const prevRoute = getPreviousStackRoute();
                if (!prevRoute || !canLeaveRoute(prevRoute, 'swipe-back')) {
                    candidate.rejected = true;
                    return;
                }

                const frontEl = currentRoute?.elementId ? document.getElementById(currentRoute.elementId) : null;
                if (!frontEl) {
                    candidate.rejected = true;
                    return;
                }

                const underlayIsHome = prevRoute.id === 'home';
                const underlayEl = underlayIsHome
                    ? document.getElementById('main-content')
                    : (prevRoute.elementId ? document.getElementById(prevRoute.elementId) : null);
                const scrim = ensureTransitionScrim();
                const floatingChrome = underlayIsHome ? getHomeFloatingElements() : [];

                candidate.locked = true;
                nativeEdgeTouchPending = false;
                lastNativeEdgeSwipeAt = 0; // 由我们的跟手手势接管，不属于原生系统手势

                document.documentElement.classList.add('is-route-transitioning');
                global.suspendAllAmbientEffects?.(true, 'route-transition');

                if (underlayIsHome) {
                    document.body.classList.remove('app-page-settled');
                    if (Math.abs((global.scrollY || 0) - homeScrollY) > 2) {
                        scrollToPosition(homeScrollY);
                    }
                    syncHomeViewportOrigin();
                    if (underlayEl) {
                        underlayEl.classList.add('is-ios-home-underlay');
                        underlayEl.style.transition = 'none';
                        underlayEl.style.willChange = 'transform';
                    }
                    floatingChrome.forEach(el => {
                        el.style.transition = 'none';
                        el.style.willChange = 'transform, opacity';
                    });
                } else if (underlayEl) {
                    resetElementTransitionStyles(underlayEl);
                    underlayEl.classList.add('is-ios-back', 'is-swipe-underlay');
                    underlayEl.hidden = false;
                    underlayEl.style.transition = 'none';
                    underlayEl.style.willChange = 'transform';
                }

                frontEl.classList.add('is-ios-front', 'is-ios-shadow', 'is-ios-dragging');
                frontEl.style.transition = 'none';
                frontEl.style.willChange = 'transform';
                scrim.classList.add('is-visible');
                scrim.style.transition = 'none';

                swipeState = {
                    active: true,
                    settling: false,
                    aborted: false,
                    prevRoute,
                    frontEl,
                    underlayEl,
                    underlayIsHome,
                    floatingChrome,
                    scrim,
                    maxScrim: getScrimMaxAlpha(),
                    dx: 0,
                    rafId: null,
                    fallbackTimer: null,
                    onEnd: null
                };
            }

            if (!swipeState?.active || swipeState.settling) return;
            event.preventDefault();

            const now = performance.now();
            const dt = Math.max(1, now - candidate.lastTime);
            const instantVx = (touch.clientX - candidate.lastX) / dt;
            candidate.vx = candidate.vx * 0.4 + instantVx * 0.6;
            candidate.lastX = touch.clientX;
            candidate.lastTime = now;

            const viewportW = Math.max(global.innerWidth || 375, 1);
            const clampedDx = Math.max(0, Math.min(viewportW, dx));
            swipeState.dx = clampedDx;

            if (swipeState.rafId) return;
            swipeState.rafId = global.requestAnimationFrame(() => {
                if (!swipeState || swipeState.settling || swipeState.aborted) return;
                swipeState.rafId = null;
                const progress = Math.min(1, Math.max(0, swipeState.dx / viewportW));
                swipeState.frontEl.style.transform = `translate3d(${swipeState.dx.toFixed(1)}px, 0, 0)`;
                swipeState.frontEl.style.setProperty('--ios-shadow-opacity', (1 - progress * 0.75).toFixed(3));
                if (swipeState.underlayEl) {
                    swipeState.underlayEl.style.transform = `translate3d(${(-26 * (1 - progress)).toFixed(2)}%, 0, 0)`;
                }
                swipeState.scrim.style.opacity = (swipeState.maxScrim * (1 - progress)).toFixed(3);
                if (swipeState.underlayIsHome && swipeState.floatingChrome.length) {
                    const chromeShift = (-16 * (1 - progress)).toFixed(1);
                    const chromeAlpha = progress.toFixed(3);
                    swipeState.floatingChrome.forEach(el => {
                        el.style.opacity = chromeAlpha;
                        el.style.transform = `translate3d(${chromeShift}px, 0, 0)`;
                    });
                }
            });
        }, { passive: false });

        function finishSwipe(cancelled = false) {
            if (cancelled && nativeEdgeTouchPending && !swipeState) {
                // Safari 原生系统滑返接管时会立刻发出 touchcancel
                lastNativeEdgeSwipeAt = Date.now();
            }
            nativeEdgeTouchPending = false;

            const c = candidate;
            candidate = null;
            const state = swipeState;
            if (!state || state.settling || state.aborted) return;
            state.settling = true;

            if (state.rafId) {
                global.cancelAnimationFrame(state.rafId);
                state.rafId = null;
            }

            const viewportW = Math.max(global.innerWidth || 375, 1);
            const progress = Math.min(1, Math.max(0, state.dx / viewportW));
            const shouldCommit = !cancelled && (
                progress > 0.34
                || ((c?.vx || 0) > 0.42 && state.dx > 36)
            );

            const dur = shouldCommit
                ? Math.max(150, Math.min(280, Math.round((1 - progress) * 300)))
                : Math.max(180, Math.min(280, Math.round(progress * 320) + 120));

            state.frontEl.classList.remove('is-ios-dragging');
            state.frontEl.style.transition = `transform ${dur}ms ${IOS_EASE_NAV}`;
            if (state.underlayEl) {
                state.underlayEl.style.transition = `transform ${dur}ms ${IOS_EASE_NAV}`;
            }
            state.scrim.style.transition = `opacity ${dur}ms ${IOS_EASE_NAV}`;

            if (shouldCommit) {
                state.frontEl.style.transform = 'translate3d(100%, 0, 0)';
                state.frontEl.style.setProperty('--ios-shadow-opacity', '0');
                if (state.underlayEl) state.underlayEl.style.transform = 'translate3d(0, 0, 0)';
                state.scrim.style.opacity = '0';
                if (state.underlayIsHome) {
                    state.floatingChrome.forEach(el => {
                        el.style.transition = `transform ${dur}ms ${IOS_EASE_NAV}, opacity ${dur}ms ease`;
                        el.style.opacity = '1';
                        el.style.transform = 'translate3d(0, 0, 0)';
                    });
                }
            } else {
                state.frontEl.style.transform = 'translate3d(0, 0, 0)';
                state.frontEl.style.setProperty('--ios-shadow-opacity', '1');
                if (state.underlayEl) state.underlayEl.style.transform = 'translate3d(-26%, 0, 0)';
                state.scrim.style.opacity = String(state.maxScrim);
                if (state.underlayIsHome) {
                    state.floatingChrome.forEach(el => {
                        el.style.transition = `transform ${dur}ms ${IOS_EASE_NAV}, opacity ${dur}ms ease`;
                        el.style.opacity = '0';
                        el.style.transform = 'translate3d(-16px, 0, 0)';
                    });
                }
            }

            let settled = false;
            const settle = () => {
                if (settled || state.aborted) return;
                settled = true;
                if (state.onEnd) state.frontEl.removeEventListener('transitionend', state.onEnd);
                if (state.fallbackTimer) global.clearTimeout(state.fallbackTimer);
                if (swipeState === state) swipeState = null;

                if (shouldCommit) {
                    // 关键防闪屏：在异步 history.back() 触发 popstate 落地前，
                    // 先把滑出的 frontEl 隐藏并保持底层页定格在 x=0，避免 1~2 帧整页闪回屏幕！
                    state.frontEl.hidden = true;
                    state.frontEl.style.transition = '';
                    state.frontEl.style.transform = '';
                    resetScrim();

                    const commitCleanup = {
                        frontEl: state.frontEl,
                        underlayEl: state.underlayEl,
                        underlayIsHome: state.underlayIsHome,
                        timerId: global.setTimeout(() => {
                            if (pendingSwipeCommitCleanup === commitCleanup) {
                                clearPendingSwipeCommitCleanup();
                            }
                        }, 260)
                    };
                    pendingSwipeCommitCleanup = commitCleanup;

                    appBack(state.prevRoute.fullPath, {
                        reason: 'swipe-back',
                        skipTransition: true
                    });
                } else {
                    cancelSwipeVisuals(state);
                    flushIdleCallbacks();
                }
            };

            const onEnd = event => {
                if (event.pseudoElement) return;
                if (event.target === state.frontEl && event.propertyName === 'transform') {
                    settle();
                }
            };
            state.onEnd = onEnd;
            state.frontEl.addEventListener('transitionend', onEnd);
            state.fallbackTimer = global.setTimeout(settle, dur + 90);
        }

        document.addEventListener('touchend', () => finishSwipe(false), { passive: true });
        document.addEventListener('touchcancel', () => finishSwipe(true), { passive: true });
    }

    function initializeNow() {
        if (initialized) return copyRoute(currentRoute);

        initialized = true;
        baseTitle = document.title || DEFAULT_TITLE;
        try {
            global.history.scrollRestoration = 'manual';
        } catch (_error) {
            // Some embedded browsers expose scrollRestoration as read-only.
        }

        global.addEventListener('popstate', () => handleLocationChange('popstate'));
        global.addEventListener('hashchange', () => handleLocationChange('hashchange'));
        global.addEventListener('keydown', handleRouteEscape, true);

        initEdgeSwipeBack();

        let scrollSyncRaf = null;
        global.addEventListener('scroll', () => {
            if (currentRoute?.id !== 'home') return;
            if (scrollSyncRaf !== null) return;
            scrollSyncRaf = runOnNextFrame(() => {
                scrollSyncRaf = null;
                if (currentRoute?.id === 'home') {
                    rememberHomeScroll(false);
                }
            });
        }, { passive: true });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden && currentRoute?.id === 'home') {
                rememberHomeScroll(true);
            }
        });

        global.addEventListener('pagehide', () => {
            if (currentRoute?.id === 'home') {
                rememberHomeScroll(true);
            }
        });

        const locationInfo = readLocation();
        const existingMetadata = readRouterState();
        const depth = existingMetadata && existingMetadata.hash === global.location.hash
            ? existingMetadata.depth
            : 0;
        const authorization = authorizeRoute(locationInfo.route);
        const initialRoute = authorization.route;
        const mustReplaceUrl = locationInfo.unknown || authorization.replace;

        if (mustReplaceUrl) {
            const hash = routeHash(initialRoute);
            const state = makeHistoryState(
                global.history.state,
                null,
                depth,
                initialRoute,
                hash
            );
            global.history.replaceState(state, '', hash);
        } else {
            replaceCurrentHistoryState(initialRoute, depth);
        }

        setCurrentHistorySnapshot(depth);
        hydrateRouteStack();
        if (initialRoute.id === 'home' && homeScrollY === 0 && (global.scrollY || global.pageYOffset || 0) > 0) {
            homeScrollY = Math.max(0, global.scrollY || global.pageYOffset || 0);
        }
        recordStackEntry(depth, initialRoute, true);
        transitionTo(initialRoute, 'init', {
            preserveAnchor: locationInfo.preserveAnchor,
            forceEntry: true,
            skipTransition: true
        });
        return copyRoute(currentRoute);
    }

    function initAppRouter() {
        if (initialized) return copyRoute(currentRoute);
        if (!document.body) {
            if (!initQueued) {
                initQueued = true;
                document.addEventListener('DOMContentLoaded', () => {
                    initQueued = false;
                    initializeNow();
                }, { once: true });
            }
            return null;
        }
        return initializeNow();
    }

    function appNavigate(path, options = {}) {
        if (!initialized) initAppRouter();
        if (!initialized) return false;

        const requestedRoute = matchRoute(path);
        const unknown = !requestedRoute;
        const authorization = authorizeRoute(requestedRoute || matchRoute('/'));
        const nextRoute = authorization.route;
        const replace = Boolean(options.replace || unknown || authorization.replaceOnNavigate);
        const reason = options.reason || (replace ? 'replace' : 'navigate');

        if (!canLeaveRoute(nextRoute, reason, options)) return false;

        const targetHash = routeHash(nextRoute);
        const sameRoute = currentRoute?.fullPath === nextRoute.fullPath;
        const sameLocation = sameRoute && global.location.hash === targetHash;
        if (sameLocation && !options.forceEntry) {
            if (replace && options.state && typeof options.state === 'object') {
                const state = makeHistoryState(
                    global.history.state,
                    options.state,
                    currentDepth,
                    nextRoute,
                    targetHash
                );
                global.history.replaceState(state, '');
                setCurrentHistorySnapshot(currentDepth);
            }
            return true;
        }

        if (currentRoute?.id === 'home' && nextRoute.id !== 'home') rememberHomeScroll(true);

        const nextDepth = replace ? currentDepth : currentDepth + 1;
        const baseState = replace ? global.history.state : null;
        const state = makeHistoryState(
            baseState,
            options.state,
            nextDepth,
            nextRoute,
            targetHash
        );
        if (replace) global.history.replaceState(state, '', targetHash);
        else global.history.pushState(state, '', targetHash);

        setCurrentHistorySnapshot(nextDepth);
        recordStackEntry(nextDepth, nextRoute, !replace);
        transitionTo(nextRoute, reason, {
            focus: options.focus,
            scroll: options.scroll,
            forceEntry: Boolean(options.forceEntry),
            skipTransition: Boolean(options.skipTransition),
            direction: options.direction
        });
        return true;
    }

    function appReplace(path, options = {}) {
        return appNavigate(path, { ...options, replace: true });
    }

    function appBack(fallback = '/', options = {}) {
        if (!initialized) initAppRouter();
        if (!initialized) return false;

        if (currentRoute?.id === 'home') rememberHomeScroll(true);
        else rememberHomeScroll();
        if (currentDepth > 0) {
            pendingBackOptions = {
                ...options,
                reason: options.reason || 'back'
            };
            global.history.back();
            return true;
        }
        return appReplace(fallback, {
            ...options,
            reason: options.reason || 'back-fallback',
            direction: 'back'
        });
    }

    function isAppRouterInitialized() {
        return initialized;
    }

    function isAppRouteActive(id) {
        if (!initialized) initAppRouter();
        return currentRoute?.id === id;
    }

    function getCurrentAppRoute() {
        if (!initialized) initAppRouter();
        return copyRoute(currentRoute);
    }

    function getLoginReturnRoute() {
        if (!initialized) initAppRouter();
        if (currentRoute?.id !== 'login') return '/';

        return resolveLoginReturnRoute(currentRoute).fullPath;
    }

    function completeLoginNavigation() {
        if (!initialized) initAppRouter();
        if (!initialized || !routerIsAuthenticated() || currentRoute?.id !== 'login') {
            return false;
        }
        const hasReturnRoute = new URLSearchParams(currentRoute.search).has('return');
        if (!hasReturnRoute) {
            return appBack('/', {
                reason: 'login-complete',
                skipGuard: true
            });
        }
        return appReplace(getLoginReturnRoute(), {
            reason: 'login-complete',
            skipGuard: true,
            direction: 'back'
        });
    }

    function forcePublicHomeRoute() {
        if (!initialized) initAppRouter();
        if (!initialized) return false;
        return appReplace('/', {
            reason: 'force-public-home',
            skipGuard: true,
            direction: 'back'
        });
    }

    global.initAppRouter = initAppRouter;
    global.isAppRouterInitialized = isAppRouterInitialized;
    global.appNavigate = appNavigate;
    global.appBack = appBack;
    global.appReplace = appReplace;
    global.isAppRouteActive = isAppRouteActive;
    global.getCurrentAppRoute = getCurrentAppRoute;
    global.getLoginReturnRoute = getLoginReturnRoute;
    global.completeLoginNavigation = completeLoginNavigation;
    global.forcePublicHomeRoute = forcePublicHomeRoute;
    global.setRouterHomeScroll = setRouterHomeScroll;
    global.rememberHomeScroll = rememberHomeScroll;
    global.isAppRouteTransitioning = isAppRouteTransitioning;
    global.onAppRouteTransitionIdle = onAppRouteTransitionIdle;
    global.isTouchMobileViewport = isTouchMobileViewport;
}(window));
