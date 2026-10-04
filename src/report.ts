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

/**
 * 为每个上报载荷生成便于服务端去重和追踪的标识。
 */
function generateUniqueId(): string {
    return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 将采集数据包装为统一的上报载荷。
 */
function createEnvelope<T>(data: T): ReportEnvelope<T> {
    return {
        id: generateUniqueId(),
        data,
    };
}

/**
 * 隔离传输回调异常，避免监控逻辑影响页面业务。
 */
function invokeSafely(callback: () => void): void {
    try {
        callback();
    } catch {
        // 上报传输失败不能影响页面业务。
    }
}

/**
 * 优先在浏览器空闲阶段执行传输，不支持时退化为异步任务。
 */
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

/**
 * 判断当前运行环境是否支持 Beacon 传输。
 */
export function isSupportSendBeacon(): boolean {
    return (
        typeof navigator !== "undefined" &&
        typeof navigator.sendBeacon === "function"
    );
}

/**
 * 通过图片查询参数发送已经序列化的上报载荷。
 */
export function imgRequest(data: string): void {
    if (typeof Image === "undefined") {
        return;
    }

    const image = new Image();
    const separator = config.url.includes("?") ? "&" : "?";
    image.src = `${config.url}${separator}data=${encodeURIComponent(data)}`;
}

/**
 * 在合适的调度时机通过 sendBeacon 发送上报载荷。
 */
export function beaconRequest(data: string): void {
    schedule(() => {
        navigator.sendBeacon(config.url, data);
    });
}

/**
 * 使用监控安装前保存的 XHR 方法发送载荷，避免采集上报请求自身。
 */
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

/**
 * 清空尚未达到批量阈值的待上报数据。
 */
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

/**
 * 合并上报配置并创建供各监控模块复用的处理器。
 */
export function configureReportHandler<T>(
    options: ReportingOptions<T>,
): ReportCallback<T> | undefined {
    setConfig(options);
    return createReportHandler(options.onReport);
}
