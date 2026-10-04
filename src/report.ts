import config, {
    setConfig,
    type ReportConfigOptions,
} from "./config.js";

export {
    getReportConfig,
    resetReportConfig,
    setConfig,
    type ReportConfig,
    type ReportConfigOptions,
} from "./config.js";

export interface ReportEnvelope<T = unknown> {
    id: string;
    data: T;
}

type ReportCallback<T> = (data: T) => void;

interface ReportingOptions<T> extends ReportConfigOptions {
    onReport?: ReportCallback<T> | undefined;
}

const reportQueue: unknown[] = [];
const originalOpen =
    typeof XMLHttpRequest === "undefined"
        ? undefined
        : XMLHttpRequest.prototype.open;
const originalSend =
    typeof XMLHttpRequest === "undefined"
        ? undefined
        : XMLHttpRequest.prototype.send;

function generateUniqueId(): string {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createEnvelope<T>(data: T): ReportEnvelope<T> {
    return {
        id: generateUniqueId(),
        data,
    };
}

function invokeSafely(callback: () => void): void {
    try {
        callback();
    } catch {
        // 上报传输失败不能影响页面业务。
    }
}

function schedule(callback: () => void): void {
    if (typeof window === "undefined") {
        return;
    }

    if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(
            () => invokeSafely(callback),
            { timeout: 3000 },
        );
        return;
    }
    setTimeout(() => invokeSafely(callback), 0);
}

export function isSupportSendBeacon(): boolean {
    return (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
    );
}

export function imgRequest(data: string): void {
    if (typeof Image === "undefined") {
        return;
    }

    const image = new Image();
    const separator = config.url.includes("?") ? "&" : "?";
    image.src = `${config.url}${separator}data=${encodeURIComponent(data)}`;
}

export function beaconRequest(data: string): void {
    schedule(() => {
        navigator.sendBeacon(config.url, data);
    });
}

export function xhrRequest(data: string): void {
    schedule(() => {
        if (
            typeof XMLHttpRequest === "undefined" ||
            !originalOpen ||
            !originalSend
        ) {
            return;
        }

        const xhr = new XMLHttpRequest();
        const open = originalOpen as (
            this: XMLHttpRequest,
            method: string,
            url: string,
        ) => void;
        open.call(xhr, "POST", config.url);
        xhr.setRequestHeader("Content-Type", "application/json");
        originalSend.call(xhr, data);
    });
}

/**
 * 立即安排一次数据上报。返回 false 表示当前没有可用的上报配置或传输方式。
 */
export function report<T>(data: T): boolean {
    if (!config.url || typeof window === "undefined") {
        return false;
    }

    let reportData: string;
    try {
        reportData = JSON.stringify(createEnvelope(data));
    } catch {
        return false;
    }
    if (config.isImageUpload) {
        if (typeof Image === "undefined") {
            return false;
        }
        imgRequest(reportData);
        return true;
    }
    if (isSupportSendBeacon()) {
        beaconRequest(reportData);
        return true;
    }
    if (typeof XMLHttpRequest !== "undefined" && originalOpen && originalSend) {
        xhrRequest(reportData);
        return true;
    }
    return false;
}

/**
 * 缓存监控数据，并在达到配置的批量大小时统一上报。
 */
export function lazyReportBatch(data: unknown): boolean {
    if (!config.url) {
        return false;
    }

    reportQueue.push(data);
    const batchSize = Math.max(1, config.batchSize);
    if (reportQueue.length < batchSize) {
        return false;
    }

    const batch = reportQueue.slice();
    if (!report(batch)) {
        return false;
    }
    reportQueue.length = 0;
    return true;
}

export function clearReportQueue(): void {
    reportQueue.length = 0;
}

/**
 * 将内置网络上报和调用方回调组合成采集模块使用的单一处理器。
 */
export function createReportHandler<T>(
    onReport?: ReportCallback<T>,
): ReportCallback<T> | undefined {
    if (!config.url && !onReport) {
        return undefined;
    }

    return (data: T) => {
        if (config.url) {
            try {
                lazyReportBatch(data);
            } catch {
                // 内置上报失败时仍需执行调用方的回调。
            }
        }
        onReport?.(data);
    };
}

export function configureReportHandler<T>(
    options: ReportingOptions<T>,
): ReportCallback<T> | undefined {
    setConfig(options);
    return createReportHandler(options.onReport);
}
