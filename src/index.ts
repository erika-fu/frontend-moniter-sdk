/**
 * Public entry point for the frontend monitoring SDK.
 *
 * Add the SDK's public API here as features are implemented.
 */
import {
    errorBoundary,
    install,
    observeError,
    type ErrorReportData,
} from "./error/index.js";
import { setFrameworkErrorReportHandler } from "./error/framework.js";
import {
    observePerformance,
    type PerformanceMonitoringOptions,
    type PerformanceReportData,
} from "./performance/index.js";

export const SDK_NAME = "frontend-moniter-sdk";

export * from "./error/index.js";
export * from "./performance/index.js";

export type SDKReportData = ErrorReportData | PerformanceReportData;
export type SDKReportHandler = (reportData: SDKReportData) => void;

export interface SDKOptions {
    /** 接收 SDK 产生的全部监控数据。 */
    onReport?: SDKReportHandler;
    /** 本次初始化是否启动错误监听；默认启动。 */
    error?: boolean;
    /** 性能监听配置；设为 false 时本次不启动，默认启动全部性能监听。 */
    performance?: false | Omit<PerformanceMonitoringOptions, "onReport">;
}

/**
 * 初始化 SDK，并按配置启动浏览器错误和性能监听。
 */
export function init(options: SDKOptions = {}): void {
    const onReport = options.onReport;

    setFrameworkErrorReportHandler(onReport);

    if (options.performance !== false) {
        const configuredPerformanceOptions: PerformanceMonitoringOptions =
            options.performance ?? {};
        const {
            onReport: _moduleReportHandler,
            ...performanceOptions
        } = configuredPerformanceOptions;
        observePerformance({
            ...performanceOptions,
            ...(onReport ? { onReport } : {}),
        });
    }

    if (options.error !== false) {
        observeError(onReport);
    }
}

const sdk = {
    init,
    install,
    errorBoundary,
    performance: observePerformance,
    error: observeError,
    observePerformance,
    observeError,
};

export default sdk;
