import { onFCP, type FCPMetric } from "web-vitals";
import { reportSafely } from "./reportSafely.js";

/**
 * FCP 上报数据。
 */
export interface FirstContentfulPaintReportData extends FCPMetric {
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "first-contentful-paint";
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

/**
 * 观测首次内容绘制（First Contentful Paint，简称 FCP）。
 *
 * web-vitals 会过滤页面首次绘制前已经隐藏等无效场景，并在 FCP
 * 确定后调用回调。这里将指标补充为 SDK 的统一性能数据格式。
 */
export function observeFCP(
    onReport?: (reportData: FirstContentfulPaintReportData) => void,
): void {
    // 服务端渲染和部分旧浏览器不支持 FCP 观测。
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof PerformanceObserver === "undefined"
    ) {
        return;
    }

    // metric 包含 FCP 数值、评级、关联性能条目和导航类型等信息。
    onFCP((metric) => {
        const reportData: FirstContentfulPaintReportData = {
            ...metric,
            type: "performance",
            subType: "first-contentful-paint",
            pageUrl: window.location.href,
        };

        reportSafely(onReport, reportData);
    });
}
