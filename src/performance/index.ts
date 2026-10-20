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
import type { ViewFirstContentfulPaintReportData } from "./observeViewFCP.js";

export * from "./observeFCP.js";
export * from "./observeFetch.js";
export * from "./observeLCP.js";
export * from "./observeLoad.js";
export * from "./observePaint.js";
export * from "./observeResources.js";
export * from "./observeViewFCP.js";
export * from "./observeXHR.js";

export type PerformanceReportData =
    | FirstPaintReportData
    | FirstContentfulPaintReportData
    | LargestContentfulPaintReportData
    | ViewFirstContentfulPaintReportData
    | LoadReportData
    | ResourceLoadReportData
    | FetchReportData
    | XHRReportData;

export type PerformanceReportHandler = (
    reportData: PerformanceReportData,
) => void;

/**
 * 性能监听配置。
 */
export interface PerformanceMonitoringOptions {
    /** 接收全部性能监控数据。 */
    onReport?: PerformanceReportHandler;
}

/**
 * 启动全部性能监听。
 */
export function observePerformance(
    options: PerformanceMonitoringOptions = {},
): void {
    observePaint(options.onReport);
    observeFCP(options.onReport);
    observeLCP(options.onReport);
    observeLoad(options.onReport);
    observeResources(options.onReport);
    observeFetch(options.onReport);
    observeXHR(options.onReport);
}

export default observePerformance;
