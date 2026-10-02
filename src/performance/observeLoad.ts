import { reportSafely } from "./reportSafely.js";

/**
 * 页面 onload 上报数据。
 */
export interface LoadReportData {
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "load";
    /** 从页面导航开始到 load 事件结束的耗时，单位为毫秒。 */
    startTime: number;
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

/**
 * 在下一帧读取 Navigation Timing 并生成 onload 待上报数据。
 *
 * load 事件监听器执行时，浏览器可能还未写入 loadEventEnd，因此延迟到
 * 下一帧读取。无法取得 Navigation Timing 时，使用 load 事件时间戳兜底。
 *
 * @param loadEventTime load 事件相对于页面时间原点发生的时间。
 */
function reportLoad(
    onReport: ((reportData: LoadReportData) => void) | undefined,
    loadEventTime?: number,
): void {
    window.requestAnimationFrame(() => {
        const navigationEntry = performance.getEntriesByType(
            "navigation",
        )[0] as PerformanceNavigationTiming | undefined;
        const loadTime =
            navigationEntry && navigationEntry.loadEventEnd > 0
                ? navigationEntry.loadEventEnd - navigationEntry.startTime
                : loadEventTime;

        if (loadTime === undefined) {
            return;
        }

        const reportData: LoadReportData = {
            type: "performance",
            subType: "load",
            startTime: loadTime,
            pageUrl: window.location.href,
        };

        reportSafely(onReport, reportData);
    });
}

/**
 * 统计页面从导航开始到 load 事件结束的耗时。
 *
 * 如果调用时页面已经加载完成则立即安排统计，否则等待一次 load 事件；
 * 监听器完成后会被移除，避免重复记录。
 */
export function observeLoad(
    onReport?: (reportData: LoadReportData) => void,
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined" ||
        typeof window.requestAnimationFrame === "undefined"
    ) {
        return;
    }

    if (document.readyState === "complete") {
        reportLoad(onReport);
        return;
    }

    // 保存事件时间戳作为旧浏览器缺少 Navigation Timing 时的兜底值。
    const onLoad = (event: Event) => {
        reportLoad(onReport, event.timeStamp);
        window.removeEventListener("load", onLoad, true);
    };
    window.addEventListener("load", onLoad, true);
}
