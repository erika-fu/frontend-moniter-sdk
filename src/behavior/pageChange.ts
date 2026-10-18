import { dispatchReport } from "../report.js";
import { stopObserveAutoPageView } from "./autoPageView.js";
import { generateBehaviorId } from "./utils.js";

export type PageChangeSubType = "hashchange" | "popstate";

/**
 * 页面地址变化上报数据。
 */
export interface PageChangeReportData {
    /** 监控数据的一级分类。 */
    type: "behavior";
    /** 触发页面变化的浏览器事件。 */
    subType: PageChangeSubType;
    /** 页面变化前的地址。 */
    from: string;
    /** 页面变化后的地址。 */
    to: string;
    /** 采集时相对于当前页面时间原点的毫秒数。 */
    startTime: number;
    /** 本条行为数据的唯一标识。 */
    uuid: string;
}

export type PageChangeReportHandler = (
    reportData: PageChangeReportData,
) => void;

let observedWindow: Window | undefined;
let reportHandler: PageChangeReportHandler | undefined;
let hashChangeHandler: ((event: HashChangeEvent) => void) | undefined;
let popStateHandler: ((event: PopStateEvent) => void) | undefined;
let previousUrl = "";

function reportPageChange(
    subType: PageChangeSubType,
    from: string,
    to: string,
): void {
    dispatchReport(
        {
            type: "behavior",
            subType,
            from,
            to,
            startTime: performance.now(),
            uuid: generateBehaviorId(),
        },
        reportHandler,
    );
}

/**
 * 监听哈希变化和浏览器历史记录导航。
 *
 * 重复调用只更新上报回调，不会重复安装事件监听器。
 */
export function observePageChange(
    onReport?: PageChangeReportHandler,
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

    stopObservePageChange();
    observedWindow = window;
    reportHandler = onReport;
    previousUrl = window.location.href;

    hashChangeHandler = (event: HashChangeEvent) => {
        reportPageChange("hashchange", event.oldURL, event.newURL);
        previousUrl = event.newURL;
    };
    popStateHandler = () => {
        const currentUrl = window.location.href;
        reportPageChange("popstate", previousUrl, currentUrl);
        previousUrl = currentUrl;
    };

    observedWindow.addEventListener("hashchange", hashChangeHandler, true);
    observedWindow.addEventListener("popstate", popStateHandler, true);
}

/**
 * 移除页面变化监听器并清空已保存的页面状态。
 *
 * 同时还原自动 PV 安装的 History 包装，避免只停止地址变化后仍留下劫持。
 */
export function stopObservePageChange(): void {
    if (observedWindow && hashChangeHandler) {
        observedWindow.removeEventListener(
            "hashchange",
            hashChangeHandler,
            true,
        );
    }
    if (observedWindow && popStateHandler) {
        observedWindow.removeEventListener(
            "popstate",
            popStateHandler,
            true,
        );
    }

    observedWindow = undefined;
    reportHandler = undefined;
    hashChangeHandler = undefined;
    popStateHandler = undefined;
    previousUrl = "";
    stopObserveAutoPageView();
}

export default observePageChange;
