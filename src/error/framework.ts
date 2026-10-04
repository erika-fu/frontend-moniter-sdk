import {
    setConfig,
    type ReportConfigOptions,
} from "../report.js";
import { getPageUrl, reportSafely } from "./utils.js";

export interface VueErrorReportData {
    type: "error";
    subType: "vue";
    error: string;
    info: string;
    pageUrl: string;
    startTime: number;
}

export interface ReactErrorReportData {
    type: "error";
    subType: "react";
    error: string;
    info: unknown;
    pageUrl: string;
    startTime: number;
}

export type FrameworkErrorReportData =
    | VueErrorReportData
    | ReactErrorReportData;

export type FrameworkErrorReportHandler = (
    reportData: FrameworkErrorReportData,
) => void;

export interface FrameworkErrorMonitoringOptions extends ReportConfigOptions {
    onReport?: FrameworkErrorReportHandler;
}

type VueErrorHandler = (
    error: unknown,
    instance: any,
    info: string,
) => unknown;

interface VueErrorConfig {
    errorHandler?: VueErrorHandler | null;
}

export interface VueErrorHandlerHost {
    config: VueErrorConfig;
}

interface VueInstallState {
    installedHandler: VueErrorHandler;
    onReport: FrameworkErrorReportHandler | undefined;
}

const vueInstallStates = new WeakMap<object, VueInstallState>();
let frameworkReportHandler: FrameworkErrorReportHandler | undefined;

/**
 * 将不同形态的异常值转换为适合上报的文本。
 */
function getErrorText(error: unknown): string {
    if (error && typeof error === "object") {
        const candidate = error as { message?: unknown; stack?: unknown };
        if (typeof candidate.stack === "string") {
            return candidate.stack;
        }
        if (typeof candidate.message === "string") {
            return candidate.message;
        }
    }
    return String(error);
}

/**
 * 获取框架异常发生时的高精度时间，不可用时回退到系统时间。
 */
function getStartTime(): number {
    if (
        typeof window !== "undefined" &&
        typeof window.performance?.now === "function"
    ) {
        return window.performance.now();
    }
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * 设置由 SDK 入口统一提供给框架错误捕获的上报回调。
 */
export function setFrameworkErrorReportHandler(
    onReport?: FrameworkErrorReportHandler,
): void {
    frameworkReportHandler = onReport;
}

/**
 * Vue 插件入口，兼容 Vue 3 app.config 和 Vue 2 Vue.config。
 */
export function install(
    host: VueErrorHandlerHost,
    options: FrameworkErrorMonitoringOptions = {},
): void {
    setConfig(options);
    const configuredReportHandler = options.onReport;
    const config = host.config;
    const existingState = vueInstallStates.get(config);

    if (existingState) {
        existingState.onReport = configuredReportHandler;
        return;
    }

    const previousHandler = config.errorHandler;
    const state: VueInstallState = {
        installedHandler: () => undefined,
        onReport: configuredReportHandler,
    };

    // 包装框架错误处理器，在上报后继续调用应用原有处理器。
    state.installedHandler = function (error, instance, info) {
        reportSafely(state.onReport ?? frameworkReportHandler, {
            type: "error",
            subType: "vue",
            error: getErrorText(error),
            info,
            pageUrl: getPageUrl(),
            startTime: getStartTime(),
        });

        return previousHandler?.call(this, error, instance, info);
    };

    vueInstallStates.set(config, state);
    config.errorHandler = state.installedHandler;
}

/**
 * 在 React Error Boundary 的 componentDidCatch 中调用。
 */
export function errorBoundary(
    error: unknown,
    info: unknown,
    onReport?: FrameworkErrorReportHandler,
): void {
    const reportHandler = onReport ?? frameworkReportHandler;
    reportSafely(reportHandler, {
        type: "error",
        subType: "react",
        error: getErrorText(error),
        info,
        pageUrl: getPageUrl(),
        startTime: getStartTime(),
    });
}
