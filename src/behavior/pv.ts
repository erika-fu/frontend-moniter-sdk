import { dispatchReport } from "../report.js";
import { generateBehaviorId } from "./utils.js";

/**
 * 页面访问（PV）上报数据。
 */
export interface PageViewReportData {
    /** 监控数据的一级分类。 */
    type: "behavior";
    /** 监控数据的二级分类。 */
    subType: "pv";
    /** 采集时相对于当前页面时间原点的毫秒数。 */
    startTime: number;
    /** 当前页面地址。 */
    pageUrl: string;
    /** 进入当前页面前的来源地址。 */
    referrer: string;
    /** 本条行为数据的唯一标识。 */
    uuid: string;
}

export type PageViewReportHandler = (
    reportData: PageViewReportData,
) => void;

let lastReportedPageUrl: string | undefined;

/**
 * 清除最近一次成功上报的页面地址。
 *
 * 停止行为监控时调用，让下一次启动可以重新记录当前页。
 */
export function clearPageViewDedup(): void {
    lastReportedPageUrl = undefined;
}

/**
 * 立即记录一次当前页面访问。
 *
 * 连续采集到相同 `pageUrl` 时跳过，避免自动监听和路由钩子把同一地址记两次。
 * 地址变化后再次调用会重新上报。
 */
export function observePV(onReport?: PageViewReportHandler): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined"
    ) {
        return;
    }

    const pageUrl = window.location.href;
    if (pageUrl === lastReportedPageUrl) {
        return;
    }

    lastReportedPageUrl = pageUrl;
    dispatchReport(
        {
            type: "behavior",
            subType: "pv",
            startTime: performance.now(),
            pageUrl,
            referrer: document.referrer,
            uuid: generateBehaviorId(),
        },
        onReport,
    );
}

export default observePV;
