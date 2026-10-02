import { reportSafely } from "./reportSafely.js";

/**
 * FP 上报数据。
 */
export interface FirstPaintReportData {
    /** 性能条目名称，FP 固定为 first-paint。 */
    name: "first-paint";
    /** 浏览器性能条目类型。 */
    entryType: "paint";
    /** FP 相对于页面时间原点发生的时间，单位为毫秒。 */
    startTime: number;
    /** paint 条目的持续时间，通常为 0。 */
    duration: number;
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "first-paint";
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

/**
 * 使用 PerformanceObserver 观测首次绘制（First Paint，简称 FP）。
 *
 * buffered 模式可以读取函数调用前已经产生的绘制条目。FP 只会确定
 * 一次，因此命中 first-paint 后立即停止观察。
 */
export function observePaint(
    onReport?: (reportData: FirstPaintReportData) => void,
): void {
    // 服务端渲染和部分旧浏览器不支持 PerformanceObserver。
    if (typeof PerformanceObserver === "undefined") {
        return;
    }

    const observer = new PerformanceObserver((list) => {
        // paint 列表中可能同时包含 first-paint 和 first-contentful-paint。
        for (const entry of list.getEntries()) {
            if (entry.name !== "first-paint") {
                continue;
            }

            // FP 只需要采集一次，获取后立即停止观察。
            observer.disconnect();

            // 在原生 PerformanceEntry 数据上补充监控分类和页面信息。
            const reportData: FirstPaintReportData = {
                name: "first-paint",
                entryType: "paint",
                startTime: entry.startTime,
                duration: entry.duration,
                type: "performance",
                subType: "first-paint",
                pageUrl: window.location.href,
            };

            reportSafely(onReport, reportData);
            break;
        }
    });

    // buffered: true 用于获取 observer 创建前已经产生的 paint 条目。
    observer.observe({
        type: "paint",
        buffered: true,
    });
}
