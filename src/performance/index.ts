import {
    observeFCP,
    type FirstContentfulPaintReportData,
} from "./observeFCP.js";
import {
    observeFetch,
    type FetchReportData,
} from "./observeFetch.js";
import {
    observeLCP,
    type LargestContentfulPaintReportData,
} from "./observeLCP.js";
import { observeLoad, type LoadReportData } from "./observeLoad.js";
import {
    observePaint,
    type FirstPaintReportData,
} from "./observePaint.js";
import {
    observeResources,
    type ResourceLoadReportData,
} from "./observeResources.js";
import {
    observeXHR,
    type XHRReportData,
} from "./observeXHR.js";

export * from "./observeFCP.js";
export * from "./observeFetch.js";
export * from "./observeLCP.js";
export * from "./observeLoad.js";
export * from "./observePaint.js";
export * from "./observeResources.js";
export * from "./observeXHR.js";

export type PerformanceMonitor =
    | "paint"
    | "fcp"
    | "lcp"
    | "load"
    | "resource"
    | "fetch"
    | "xhr";

export type PerformanceReportData =
    | FirstPaintReportData
    | FirstContentfulPaintReportData
    | LargestContentfulPaintReportData
    | LoadReportData
    | ResourceLoadReportData
    | FetchReportData
    | XHRReportData;

export type PerformanceReportHandler = (
    reportData: PerformanceReportData,
) => void;

const ALL_MONITORS: readonly PerformanceMonitor[] = [
    "paint",
    "fcp",
    "lcp",
    "load",
    "resource",
    "fetch",
    "xhr",
];

/**
 * 性能监听配置。
 */
export interface PerformanceMonitoringOptions {
    /** 需要启用的监控项；不传时启用全部监控。 */
    monitors?: readonly PerformanceMonitor[];
    /** 接收全部性能监控数据。 */
    onReport?: PerformanceReportHandler;
}

/**
 * 根据配置启动性能监听；默认启动全部监控项。
 */
export function observePerformance(
    options: PerformanceMonitoringOptions = {},
): void {
    const monitors = new Set(options.monitors ?? ALL_MONITORS);

    if (monitors.has("paint")) {
        observePaint(options.onReport);
    }
    if (monitors.has("fcp")) {
        observeFCP(options.onReport);
    }
    if (monitors.has("lcp")) {
        observeLCP(options.onReport);
    }
    if (monitors.has("load")) {
        observeLoad(options.onReport);
    }
    if (monitors.has("resource")) {
        observeResources(options.onReport);
    }
    if (monitors.has("fetch")) {
        observeFetch(options.onReport);
    }
    if (monitors.has("xhr")) {
        observeXHR(options.onReport);
    }
}

export default observePerformance;
