import {
    cancelNavigationAttempt,
    commitNavigationAttempt,
    markNavigationRedirect,
    startNavigationAttempt,
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
