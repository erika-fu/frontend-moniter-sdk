import {
    observeClick,
    stopObserveClick,
    type ClickReportData,
} from "./click.js";
import {
    observePageChange,
    stopObservePageChange,
    type PageChangeReportData,
} from "./pageChange.js";
import { observePV, type PageViewReportData } from "./pv.js";

export * from "./click.js";
export * from "./pageChange.js";
export * from "./pv.js";

export type BehaviorReportData =
    | ClickReportData
    | PageViewReportData
    | PageChangeReportData;
export type BehaviorReportHandler = (
    reportData: BehaviorReportData,
) => void;

export type BehaviorMonitor = "click" | "pageChange" | "pv";

const ALL_MONITORS: readonly BehaviorMonitor[] = [
    "click",
    "pageChange",
    "pv",
];

/**
 * 行为监听配置。
 */
export interface BehaviorMonitoringOptions {
    /** 需要启用的监控项；不传时启用全部监控。 */
    monitors?: readonly BehaviorMonitor[];
    /** 接收全部行为监控数据。 */
    onReport?: BehaviorReportHandler;
}

/**
 * 根据配置启动用户行为监听；默认启动全部监控项。
 */
export function observeBehavior(
    options: BehaviorMonitoringOptions = {},
): void {
    const monitors = new Set(options.monitors ?? ALL_MONITORS);

    if (monitors.has("click")) {
        observeClick(options.onReport);
    } else {
        stopObserveClick();
    }

    if (monitors.has("pageChange")) {
        observePageChange(options.onReport);
    } else {
        stopObservePageChange();
    }

    if (monitors.has("pv")) {
        observePV(options.onReport);
    }
}

/**
 * 停止所有需要长期驻留的行为事件监听器。
 *
 * PV 在启动时立即采集，不注册监听器，因此无需单独停止。
 */
export function stopObserveBehavior(): void {
    stopObserveClick();
    stopObservePageChange();
}

export default observeBehavior;
