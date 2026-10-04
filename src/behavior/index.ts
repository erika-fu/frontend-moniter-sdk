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

/**
 * 行为监听配置。
 */
export interface BehaviorMonitoringOptions {
    /** 接收全部行为监控数据。 */
    onReport?: BehaviorReportHandler;
}

/**
 * 启动全部用户行为监听。
 */
export function observeBehavior(
    options: BehaviorMonitoringOptions = {},
): void {
    observeClick(options.onReport);
    observePageChange(options.onReport);
    observePV(options.onReport);
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
