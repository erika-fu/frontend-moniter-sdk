import type { FrameworkErrorReportData } from "./framework.js";
import { dispatchReport } from "../report.js";
import { getPageUrl } from "./utils.js";

export { errorBoundary, install } from "./framework.js";
export type {
    FrameworkErrorMonitoringOptions,
    FrameworkErrorReportData,
    FrameworkErrorReportHandler,
    ReactErrorReportData,
    VueErrorHandlerHost,
    VueErrorReportData,
} from "./framework.js";

/**
 * 运行时错误的公共字段。
 */
interface RuntimeErrorReportBase {
    type: "error";
    pageUrl: string;
}

/**
 * 资源加载失败上报数据。
 */
export interface ResourceErrorReportData extends RuntimeErrorReportBase {
    subType: "resource";
    url: string;
    html: string;
    /** 事件传播路径；运行环境不支持时为 undefined。 */
    paths?: EventTarget[];
}

/**
 * JavaScript 同步异常上报数据。
 */
export interface JavaScriptErrorReportData extends RuntimeErrorReportBase {
    subType: "js";
    msg: string;
    url: string;
    lineNo: number | undefined;
    columnNo: number | undefined;
    startTime: number;
    stack?: string | undefined;
}

/**
 * 未处理 Promise rejection 上报数据。
 */
export interface PromiseErrorReportData extends RuntimeErrorReportBase {
    subType: "promise";
    reason: string;
    startTime: number;
}

export type ErrorReportData =
    | ResourceErrorReportData
    | JavaScriptErrorReportData
    | PromiseErrorReportData
    | FrameworkErrorReportData;

export type ErrorReportHandler = (reportData: ErrorReportData) => void;

interface ErrorWindow extends Window {
    onerror: OnErrorEventHandler | null;
}

let observedWindow: ErrorWindow | undefined;
let previousOnError: OnErrorEventHandler | null | undefined;
let installedOnError: OnErrorEventHandler | null | undefined;
let reportHandler: ErrorReportHandler | undefined;
let resourceErrorHandler: ((event: Event) => void) | undefined;
let rejectionHandler: ((event: PromiseRejectionEvent) => void) | undefined;

function getErrorStack(error: unknown): string | undefined {
    if (error && typeof error === "object" && "stack" in error) {
        const stack = (error as { stack?: unknown }).stack;
        return typeof stack === "string" ? stack : undefined;
    }
    return undefined;
}

function getErrorReason(reason: unknown): string {
    if (typeof reason === "string") {
        return reason;
    }
    if (reason instanceof Error) {
        return reason.stack ?? reason.message;
    }
    if (reason && typeof reason === "object") {
        try {
            return JSON.stringify(reason);
        } catch {
            return String(reason);
        }
    }
    return String(reason);
}

function getResourceUrl(target: EventTarget): string | undefined {
    if (!target || typeof target !== "object") {
        return undefined;
    }

    const resource = target as EventTarget & {
        src?: string;
        href?: string;
    };
    return resource.src || resource.href || undefined;
}

/**
 * 监听资源加载失败、同步 JavaScript 异常和未处理 Promise rejection。
 *
 * 重复调用只更新上报回调，不会重复安装监听器。
 */
export function observeError(onReport?: ErrorReportHandler): void {
    if (typeof window === "undefined") {
        return;
    }

    const currentWindow = window as ErrorWindow;
    if (observedWindow === currentWindow) {
        reportHandler = onReport;
        return;
    }

    stopObserveError();
    observedWindow = currentWindow;
    reportHandler = onReport;
    previousOnError = currentWindow.onerror;

    resourceErrorHandler = (event: Event) => {
        const target = event.target;
        if (!target) {
            return;
        }

        const url = getResourceUrl(target);
        if (!url) {
            return;
        }

        const element = target as EventTarget & {
            outerHTML?: string;
        };
        const legacyEvent = event as Event & { path?: EventTarget[] };
        const paths =
            typeof event.composedPath === "function"
                ? event.composedPath()
                : legacyEvent.path;
        dispatchReport(
            {
                type: "error",
                subType: "resource",
                url,
                html: element.outerHTML ?? "",
                pageUrl: getPageUrl(),
                ...(paths ? { paths } : {}),
            },
            reportHandler,
        );
    };

    rejectionHandler = (event: PromiseRejectionEvent) => {
        dispatchReport(
            {
                type: "error",
                subType: "promise",
                reason: getErrorReason(event.reason),
                pageUrl: getPageUrl(),
                startTime: event.timeStamp,
            },
            reportHandler,
        );
    };

    currentWindow.addEventListener("error", resourceErrorHandler, true);
    currentWindow.addEventListener(
        "unhandledrejection",
        rejectionHandler,
        true,
    );
    installedOnError = (
        message,
        source,
        lineno,
        colno,
        error,
    ) => {
        dispatchReport(
            {
                type: "error",
                subType: "js",
                msg: String(message),
                url: String(source),
                lineNo: lineno,
                columnNo: colno,
                ...(getErrorStack(error)
                    ? { stack: getErrorStack(error) }
                    : {}),
                pageUrl: getPageUrl(),
                startTime: performance.now(),
            },
            reportHandler,
        );

        return previousOnError?.call(
            currentWindow,
            message,
            source,
            lineno,
            colno,
            error,
        ) ?? false;
    };
    currentWindow.onerror = installedOnError;
}

/**
 * 移除错误监听器，并在没有被其他代码替换时恢复原有 onerror。
 */
export function stopObserveError(): void {
    if (!observedWindow) {
        return;
    }

    if (resourceErrorHandler) {
        observedWindow.removeEventListener("error", resourceErrorHandler, true);
    }
    if (rejectionHandler) {
        observedWindow.removeEventListener(
            "unhandledrejection",
            rejectionHandler,
            true,
        );
    }
    if (observedWindow.onerror === installedOnError) {
        observedWindow.onerror = previousOnError ?? null;
    }

    observedWindow = undefined;
    previousOnError = undefined;
    installedOnError = undefined;
    reportHandler = undefined;
    resourceErrorHandler = undefined;
    rejectionHandler = undefined;
}

export default observeError;
