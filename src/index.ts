/**
 * Public entry point for the frontend monitoring SDK.
 *
 * Add the SDK's public API here as features are implemented.
 */
import {
    observeBehavior,
    type BehaviorReportData,
} from "./behavior/index.js";
import {
    errorBoundary,
    install,
    observeError,
    type ErrorReportData,
} from "./error/index.js";
import {
    observePerformance,
    type PerformanceReportData,
} from "./performance/index.js";
import {
    setConfig,
    subscribeReports,
    type ReportConfigOptions,
} from "./report.js";
import {
    createReplayUrl,
    observeReplay,
    type ReplayReportData,
} from "./replay/index.js";

export const SDK_NAME = "frontend-moniter-sdk";

export * from "./behavior/index.js";
export * from "./error/index.js";
export * from "./performance/index.js";
export * from "./replay/index.js";
export {
    beaconRequest,
    flushReportQueue,
    imgRequest,
    isSupportSendBeacon,
    lazyReportBatch,
    report,
    setConfig,
    xhrRequest,
    type ReportConfig,
    type ReportConfigOptions,
    type ReportEnvelope,
} from "./report.js";

export type SDKReportData =
    | BehaviorReportData
    | ErrorReportData
    | PerformanceReportData
    | ReplayReportData;
export type SDKReportHandler = (reportData: SDKReportData) => void;

export type SDKOptions = ReportConfigOptions;

/**
 * 初始化 SDK，并更新默认上报配置。
 */
export function init(options: SDKOptions = {}): void {
    setConfig(options);
}

/**
 * 订阅 SDK 采集到的数据，不参与或替代网络上报。
 */
export function subscribe(onReport: SDKReportHandler): () => void {
    return subscribeReports(onReport);
}

const sdk = {
    init,
    subscribe,
    install,
    errorBoundary,
    behavior: observeBehavior,
    performance: observePerformance,
    error: observeError,
    replay: observeReplay,
    createReplayUrl,
    observeBehavior,
    observePerformance,
    observeError,
    observeReplay,
};

export default sdk;
