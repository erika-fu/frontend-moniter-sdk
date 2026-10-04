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

/**
 * 立即记录一次当前页面访问。
 */
export function observePV(onReport?: PageViewReportHandler): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined"
    ) {
        return;
    }

    dispatchReport(
        {
            type: "behavior",
            subType: "pv",
            startTime: performance.now(),
            pageUrl: window.location.href,
            referrer: document.referrer,
            uuid: generateBehaviorId(),
        },
        onReport,
    );
}

export default observePV;
