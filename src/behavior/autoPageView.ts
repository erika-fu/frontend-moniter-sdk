import { observePV, type PageViewReportHandler } from "./pv.js";

// 保存本轮监听所使用的浏览器对象、事件处理器和 History 方法，
// 以便重复初始化时复用监听，并在停止监听时完整恢复现场。
let observedWindow: Window | undefined;
let reportHandler: PageViewReportHandler | undefined;
let hashChangeHandler: (() => void) | undefined;
let popStateHandler: (() => void) | undefined;
let patchedHistory: History | undefined;
let originalPushState: History["pushState"] | undefined;
let originalReplaceState: History["replaceState"] | undefined;
let wrappedPushState: History["pushState"] | undefined;
let wrappedReplaceState: History["replaceState"] | undefined;

/** 使用最新注册的回调上报当前页面的 PV。 */
function reportCurrentPageView(): void {
    observePV(reportHandler);
}

/** 包装指定的 History 方法，在路由更新成功后触发一次 PV 上报。 */
function patchHistoryMethod(method: "pushState" | "replaceState"): void {
    const historyApi = patchedHistory;
    if (!historyApi) {
        return;
    }

    const original = historyApi[method];
    const wrapped = function (
        this: History,
        ...args: Parameters<History["pushState"]>
    ) {
        const result = Reflect.apply(original, this, args);
        reportCurrentPageView();
        return result;
    } as History["pushState"];

    if (method === "pushState") {
        originalPushState = original;
        wrappedPushState = wrapped;
    } else {
        originalReplaceState = original;
        wrappedReplaceState = wrapped;
    }

    historyApi[method] = wrapped;
}

/** 仅当方法仍是本模块安装的包装函数时，才恢复原始实现。 */
function restoreHistoryMethod(
    method: "pushState" | "replaceState",
    original: History["pushState"] | undefined,
    wrapped: History["pushState"] | undefined,
): void {
    if (!patchedHistory || !original || !wrapped) {
        return;
    }

    if (patchedHistory[method] === wrapped) {
        patchedHistory[method] = original;
    }
}

/**
 * 在 URL 变化时自动记录 PV。
 *
 * 监听 `hashchange` 与 `popstate`，并包装 `history.pushState` /
 * `history.replaceState`。包装只在原方法成功返回后上报，停止时会还原。
 * 重复调用只更新上报回调，不会重复安装监听器。
 */
export function observeAutoPageView(
    onReport?: PageViewReportHandler,
): void {
    if (
        typeof window === "undefined" ||
        typeof performance === "undefined" ||
        typeof window.addEventListener !== "function"
    ) {
        return;
    }

    if (observedWindow === window) {
        reportHandler = onReport;
        return;
    }

    stopObserveAutoPageView();
    observedWindow = window;
    reportHandler = onReport;

    hashChangeHandler = () => {
        reportCurrentPageView();
    };
    popStateHandler = () => {
        reportCurrentPageView();
    };

    observedWindow.addEventListener("hashchange", hashChangeHandler, true);
    observedWindow.addEventListener("popstate", popStateHandler, true);

    const historyApi = window.history;
    if (
        historyApi &&
        typeof historyApi.pushState === "function" &&
        typeof historyApi.replaceState === "function"
    ) {
        patchedHistory = historyApi;
        patchHistoryMethod("pushState");
        patchHistoryMethod("replaceState");
    }
}

/**
 * 移除自动 PV 监听器，并把 History 方法还原为包装前的实现。
 */
export function stopObserveAutoPageView(): void {
    if (observedWindow && hashChangeHandler) {
        observedWindow.removeEventListener(
            "hashchange",
            hashChangeHandler,
            true,
        );
    }
    if (observedWindow && popStateHandler) {
        observedWindow.removeEventListener("popstate", popStateHandler, true);
    }

    restoreHistoryMethod("pushState", originalPushState, wrappedPushState);
    restoreHistoryMethod(
        "replaceState",
        originalReplaceState,
        wrappedReplaceState,
    );

    observedWindow = undefined;
    reportHandler = undefined;
    hashChangeHandler = undefined;
    popStateHandler = undefined;
    patchedHistory = undefined;
    originalPushState = undefined;
    originalReplaceState = undefined;
    wrappedPushState = undefined;
    wrappedReplaceState = undefined;
}

export default observeAutoPageView;
