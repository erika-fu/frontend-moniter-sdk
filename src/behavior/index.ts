import {
    observeAutoPageView,
    stopObserveAutoPageView,
} from "./autoPageView.js";
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
import {
    clearPageViewDedup,
    observePV,
    type PageViewReportData,
} from "./pv.js";

export * from "./autoPageView.js";
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
    /**
     * 是否在 URL 变化时自动上报 PV。
     *
     * 默认开启。设为 false 时只保留启动时的一次 PV，后续由业务调用 `observePV()`。
     */
    autoPageView?: boolean;
}

/**
 * 启动全部用户行为监听。
 *
 * 顺序是 click、page change、自动 PV（默认开启）、当前页 PV。
 */
export function observeBehavior(
    options: BehaviorMonitoringOptions = {},
): void {
    observeClick(options.onReport);
    observePageChange(options.onReport);
    if (options.autoPageView === false) {
        stopObserveAutoPageView();
    } else {
        observeAutoPageView(options.onReport);
    }
    observePV(options.onReport);
}

/**
 * 停止需要长期驻留的行为事件监听器。
 *
 * 会还原 History 包装，并清除 PV 去重缓存，使下次启动能重新记录当前页。
 * `stopObservePageChange()` 也会还原 History 包装。
 */
export function stopObserveBehavior(): void {
    stopObserveClick();
    stopObservePageChange();
    stopObserveAutoPageView();
    clearPageViewDedup();
}

export default observeBehavior;
