(function setupAppRouter(global) {
    'use strict';

    const ROUTER_STATE_KEY = '__sweetDiaryRouter';
    const ROUTER_STATE_VERSION = 1;
    const DEFAULT_TITLE = '甜蜜记';

    const ROUTE_DEFINITIONS = [
        { id: 'home', pattern: '/', label: '', elementId: null, protected: false },
        { id: 'login', pattern: '/login', label: '登录', elementId: 'login-overlay', protected: false },
        { id: 'moment', pattern: '/moments/new', label: '发布动态', elementId: 'momentModal', protected: true },
        { id: 'mood', pattern: '/mood/check-in', label: '心情打卡', elementId: 'moodModal', protected: true },
        { id: 'mood', pattern: '/mood/edit/:id', label: '编辑心情', elementId: 'moodModal', protected: true },
        { id: 'mood-day', pattern: '/mood/day/:date', label: '心情记录', elementId: 'moodDayModal', protected: true },
        { id: 'filter', pattern: '/memories/filter', label: '检索回忆', elementId: 'filterModal', protected: true },
        { id: 'blindbox', pattern: '/memories/blind-box', label: '回忆盲盒', elementId: 'blindBoxModal', protected: true },
        { id: 'ai', pattern: '/agnes', label: 'Agnes 2.0 情感助理', elementId: 'aiModal', protected: true },
        { id: 'ai-chat', pattern: '/agnes/chat', label: '和 Agnes 2.0 聊聊', elementId: 'aiChatOverlay', protected: true },
        { id: 'settings', pattern: '/settings', label: '系统设置', elementId: 'settingsModal', protected: true },
        { id: 'milestones', pattern: '/milestones', label: '大事记', elementId: 'milestonesModal', protected: true },
        // The static edit route must precede the dynamic author route.
        { id: 'edit-profile', pattern: '/profile/edit', label: '编辑资料', elementId: 'edit-profile-page', protected: true },
        { id: 'profile', pattern: '/profile/:author', label: '个人主页', elementId: 'profile-page', protected: true }
    ];

    const PAGE_ELEMENT_IDS = Array.from(new Set(
        ROUTE_DEFINITIONS.map(route => route.elementId).filter(Boolean)
    ));
    const GLOBAL_CHROME_IDS = [
        'skip-link',
        'main-content',
        'fab-container',
        'login-trigger-btn',
        'user-avatar-btn',
        'user-dropdown',
        'notification-bell',
        'notification-panel',
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
    let homeScrollY = 0;
    let transitionToken = 0;
    let chromeSnapshot = null;
    const routeFocusMemory = new Map();
    let restoringNavigation = null;
    let pendingBackOptions = null;

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

        const label = definition.id === 'profile' && params.author
            ? `${params.author}的主页`
            : definition.label;
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
            protected: definition.protected
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

    function setElementInert(element, inert) {
        if (!element) return;
        element.inert = inert;
        if (inert) element.setAttribute('inert', '');
        else element.removeAttribute('inert');
    }

    function updatePageVisibility(route) {
        PAGE_ELEMENT_IDS.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;

            const active = route.elementId === id;
            element.classList.toggle('is-active', active);
            element.hidden = !active;
            setElementInert(element, !active);
            element.setAttribute('aria-hidden', String(!active));
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

    function rememberHomeScroll() {
        if (currentRoute?.id !== 'home') return;
        homeScrollY = Math.max(0, global.scrollY || global.pageYOffset || 0);
    }

    function runOnNextFrame(callback) {
        if (typeof global.requestAnimationFrame === 'function') {
            global.requestAnimationFrame(callback);
        } else {
            global.setTimeout(callback, 0);
        }
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

        runOnNextFrame(() => {
            if (token !== transitionToken || currentRoute?.fullPath !== route.fullPath) return;
            if (options.scroll !== false) {
                if (route.id === 'home') {
                    scrollToPosition(homeScrollY);
                } else {
                    scrollToPosition(0);
                    const page = route.elementId ? document.getElementById(route.elementId) : null;
                    const pageScroller = page?.querySelector(
                        '.app-page-scroll, .profile-body, .edit-body'
                    );
                    pageScroller?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
                }
            }
            if (options.focus === false) return;
            runOnNextFrame(() => {
                if (token === transitionToken && currentRoute?.fullPath === route.fullPath) {
                    focusRoute(route);
                }
            });
        });
    }

    function transitionTo(route, reason, options = {}) {
        const previous = currentRoute;
        const changed = !previous || previous.fullPath !== route.fullPath;

        if (previous?.id === 'home' && route.id !== 'home') rememberHomeScroll();
        if (changed && previous) rememberRouteFocus(previous);
        if (changed && previous) invokeHook('onAppRouteLeave', previous, route);

        updatePageVisibility(route);
        document.body?.classList?.toggle('app-page-active', route.id !== 'home');
        if (route.id === 'home') unlockGlobalChrome();
        else lockGlobalChrome();
        document.title = route.title;
        currentRoute = route;

        if (changed) invokeHook('onAppRouteEnter', route, previous);
        if (changed || options.forceEntry) scheduleRouteEntry(route, options);
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

        if (currentRoute?.id === 'home' && nextRoute.id !== 'home') rememberHomeScroll();

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
        if (currentRoute?.fullPath === nextRoute.fullPath) return;
        transitionTo(nextRoute, effectiveReason, {
            preserveAnchor: locationInfo.preserveAnchor
        });
    }

    function handleRouteEscape(event) {
        if (event.key !== 'Escape' || event.defaultPrevented || currentRoute?.id === 'home') return;
        if (document.getElementById('lightbox')?.classList.contains('show')) return;
        if (document.querySelector('dialog[open]')) return;

        const diaryPicker = document.getElementById('aiDiaryPicker');
        if (currentRoute?.id === 'ai-chat' && diaryPicker && !diaryPicker.hidden) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof global.closeAIDiaryPicker === 'function') global.closeAIDiaryPicker();
            return;
        }

        event.preventDefault();
        appBack('/');
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
        transitionTo(initialRoute, 'init', {
            preserveAnchor: locationInfo.preserveAnchor,
            forceEntry: true
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

        if (currentRoute?.id === 'home' && nextRoute.id !== 'home') rememberHomeScroll();

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
        transitionTo(nextRoute, reason, {
            focus: options.focus,
            scroll: options.scroll,
            forceEntry: Boolean(options.forceEntry)
        });
        return true;
    }

    function appReplace(path, options = {}) {
        return appNavigate(path, { ...options, replace: true });
    }

    function appBack(fallback = '/', options = {}) {
        if (!initialized) initAppRouter();
        if (!initialized) return false;

        rememberHomeScroll();
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
            reason: options.reason || 'back-fallback'
        });
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
            skipGuard: true
        });
    }

    function forcePublicHomeRoute() {
        if (!initialized) initAppRouter();
        if (!initialized) return false;
        return appReplace('/', {
            reason: 'force-public-home',
            skipGuard: true
        });
    }

    global.initAppRouter = initAppRouter;
    global.appNavigate = appNavigate;
    global.appBack = appBack;
    global.appReplace = appReplace;
    global.isAppRouteActive = isAppRouteActive;
    global.getCurrentAppRoute = getCurrentAppRoute;
    global.getLoginReturnRoute = getLoginReturnRoute;
    global.completeLoginNavigation = completeLoginNavigation;
    global.forcePublicHomeRoute = forcePublicHomeRoute;
}(window));
