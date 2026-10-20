import {
    cancelNavigationAttempt,
    commitNavigationAttempt,
    markNavigationRedirect,
    markViewFirstContentfulPaint,
    observeViewFirstContentfulPaint,
    observeViewLargestContentfulPaint,
    resetViewFirstContentfulPaint,
    resetViewLargestContentfulPaint,
    startNavigationAttempt,
    stopObserveViewFirstContentfulPaint,
    stopObserveViewLargestContentfulPaint,
} from "../../src/index.js";

export function requestWithFetch(success: boolean): void {
    const path = success
        ? window.location.pathname
        : `/sdk-demo-fetch-${Date.now()}.json`;
    void fetch(path).catch(() => undefined);
}

export function requestWithXHR(success: boolean): void {
    const xhr = new XMLHttpRequest();
    xhr.open(
        "GET",
        success
            ? window.location.pathname
            : `/sdk-demo-xhr-${Date.now()}.json`,
    );
    xhr.send();
}

export function throwJavaScriptError(): void {
    window.setTimeout(() => {
        throw new Error("demo: JavaScript runtime error");
    });
}

export function rejectPromise(): void {
    void Promise.reject(new Error("demo: unhandled Promise rejection"));
}

export function failResource(): void {
    const image = new Image();
    image.hidden = true;
    image.addEventListener("error", () => image.remove(), { once: true });
    document.body.append(image);
    image.src = `/sdk-demo-resource-${Date.now()}.png`;
}

export function switchRoute(route: string): void {
    window.location.hash = route;
}

/**
 * 用 History API 切换查询参数，触发 SDK 对 pushState 的自动 PV。
 */
export function pushHistoryRoute(route: string): void {
    const url = new URL(window.location.href);
    url.searchParams.set("route", route);
    window.history.pushState({ route }, "", url);
}

/**
 * 演示框架式 Navigation Attempt：先提交最终目的地，再更新可见 URL。
 *
 * 先 commit 再改 hash，避免自动 PV 抢先占用同一地址并丢掉 Page Name。
 * 生产接入通常关闭 `autoPageView`，只在路由成功钩子里 commit。
 */
export function commitManualNavigation(
    route: string,
    pageName: string,
    routePattern: string,
): void {
    const pageUrl = new URL(route, window.location.href).href;
    startNavigationAttempt();
    commitNavigationAttempt({
        pageName,
        routePattern,
        pageUrl,
    });
    window.location.hash = route;
}

/**
 * 演示取消的 Navigation Attempt：不产生 Page View。
 */
export function cancelManualNavigation(): void {
    startNavigationAttempt();
    cancelNavigationAttempt();
}

/**
 * 演示重定向链：中间目的地不上报，最终页保留原始 View Start 与 redirectCount。
 *
 * pageUrl 故意带上 `token`，提交后应被脱敏剥离。
 */
export function commitRedirectNavigation(): void {
    const pageUrl = new URL(
        "#/scenario/orders?token=secret&id=7",
        window.location.href,
    ).href;
    startNavigationAttempt();
    markNavigationRedirect();
    markNavigationRedirect();
    commitNavigationAttempt({
        pageName: "orders",
        routePattern: "/scenario/orders",
        pageUrl,
    });
    window.location.hash = "#/scenario/orders";
}

export type SkeletonToContentPhase = "idle" | "skeleton" | "content";

export interface SkeletonToContentResult {
    root: HTMLElement;
    phase: SkeletonToContentPhase;
    dispose: () => void;
}

/**
 * 可复现的 skeleton → 真实内容场景，演示 View First Contentful Paint。
 *
 * 1. 提交 Page View（Navigation Attempt）
 * 2. 在声明内容区放入 skeleton（不应触发 VFCP）
 * 3. 延迟后替换为 `data-view-content`（declared-content）或调用 mark（application-mark）
 */
export function runSkeletonToContentScenario(
    mode: "declared-content" | "application-mark" = "declared-content",
    delayMs = 400,
): SkeletonToContentResult {
    resetViewFirstContentfulPaint();

    const pageUrl = new URL(
        `#/scenario/delayed-content?t=${Date.now()}`,
        window.location.href,
    ).href;
    startNavigationAttempt();
    commitNavigationAttempt({
        pageName: "delayed-content",
        routePattern: "/scenario/delayed-content",
        pageUrl,
    });
    window.location.hash = "#/scenario/delayed-content";

    const root = document.createElement("section");
    root.setAttribute("data-view-fcp-root", "");
    root.setAttribute("aria-label", "delayed content scenario");
    document.body.append(root);

    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-view-skeleton", "");
    skeleton.textContent = "Loading product…";
    root.append(skeleton);

    if (mode === "declared-content") {
        observeViewFirstContentfulPaint({ root });
    }

    let phase: SkeletonToContentPhase = "skeleton";
    const timer = window.setTimeout(() => {
        skeleton.remove();
        const content = document.createElement("article");
        content.textContent = "Product details ready";
        if (mode === "declared-content") {
            content.setAttribute("data-view-content", "");
        }
        root.append(content);
        phase = "content";
        if (mode === "application-mark") {
            markViewFirstContentfulPaint();
        }
    }, delayMs);

    return {
        root,
        get phase() {
            return phase;
        },
        dispose() {
            window.clearTimeout(timer);
            stopObserveViewFirstContentfulPaint();
            root.remove();
            phase = "idle";
        },
    };
}

export type ViewLargestContentfulPaintPhase = "small" | "replaced" | "idle";

export interface ViewLargestContentfulPaintScenario {
    root: HTMLElement;
    readonly phase: ViewLargestContentfulPaintPhase;
    dispose: () => void;
}

/**
 * 首屏区内先放一个小候选，同时展示更大的广告（默认排除）。
 * 延迟后插入更大的合格内容，替换本地候选；超时后只上报一次最终值。
 */
export function runViewLargestContentfulPaintScenario(options?: {
    replacementDelay?: number;
    timeout?: number;
}): ViewLargestContentfulPaintScenario {
    resetViewLargestContentfulPaint();
    const replacementDelay = options?.replacementDelay ?? 700;
    const timeout = options?.timeout ?? 8_000;

    const pageUrl = new URL(
        `#/scenario/view-lcp?t=${Date.now()}`,
        window.location.href,
    ).href;
    startNavigationAttempt();
    commitNavigationAttempt({
        pageName: "view-lcp",
        routePattern: "/scenario/view-lcp",
        pageUrl,
    });
    window.location.hash = "#/scenario/view-lcp";

    const root = document.createElement("section");
    root.setAttribute("data-view-lcp-demo", "");
    root.setAttribute("aria-label", "view largest contentful paint scenario");
    document.body.append(root);

    const status = document.createElement("p");
    status.setAttribute("data-view-lcp-status", "");
    status.textContent =
        "小候选已出现。更大的广告被排除，候选替换前不会上报。";
    root.append(status);

    const region = document.createElement("div");
    region.setAttribute("data-view-lcp-root", "");
    root.append(region);

    const small = document.createElement("p");
    small.setAttribute("data-view-lcp-candidate", "small");
    small.style.width = "120px";
    small.style.height = "48px";
    small.textContent = "摘要";
    region.append(small);

    const advertising = document.createElement("aside");
    advertising.setAttribute("data-view-advertising", "");
    const excluded = document.createElement("p");
    excluded.setAttribute("data-view-lcp-excluded", "");
    excluded.style.width = "640px";
    excluded.style.height = "360px";
    excluded.textContent = "更大的广告，默认不计入";
    advertising.append(excluded);
    region.append(advertising);

    observeViewLargestContentfulPaint({ root: region, timeout });

    let phase: ViewLargestContentfulPaintPhase = "small";
    const timer = window.setTimeout(() => {
        const large = document.createElement("p");
        large.setAttribute("data-view-lcp-candidate", "large");
        large.style.width = "360px";
        large.style.height = "200px";
        large.textContent = "主内容已替换为更大的候选";
        region.append(large);
        phase = "replaced";
        status.textContent =
            "更大的合格内容已替换候选。广告仍然更大，但不会成为候选。";
    }, replacementDelay);

    return {
        root,
        get phase() {
            return phase;
        },
        dispose() {
            window.clearTimeout(timer);
            stopObserveViewLargestContentfulPaint();
            root.remove();
            phase = "idle";
        },
    };
}
