import { onLCP, type LCPMetric } from "web-vitals";
import { reportSafely } from "./reportSafely.js";

/**
 * LCP 上报数据。
 */
export interface LargestContentfulPaintReportData extends LCPMetric {
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "largest-contentful-paint";
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

/**
 * 观测最大内容绘制（Largest Contentful Paint，简称 LCP）。
 *
 * LCP 在页面加载期间可能多次更新候选元素。web-vitals 会持续跟踪
 * 候选值，并在首次交互或页面隐藏等最终确认时机调用回调。
 */
export function observeLCP(
    onReport?: (reportData: LargestContentfulPaintReportData) => void,
): void {
    // 服务端渲染和部分旧浏览器不支持 LCP 观测。
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof PerformanceObserver === "undefined"
    ) {
        return;
    }

    // metric 是最终确认的 LCP，包含数值、评级和对应元素的性能条目。
    onLCP((metric) => {
        const reportData: LargestContentfulPaintReportData = {
            ...metric,
            type: "performance",
            subType: "largest-contentful-paint",
            pageUrl: window.location.href,
        };

        reportSafely(onReport, reportData);
    });
}
