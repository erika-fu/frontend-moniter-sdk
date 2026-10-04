import config, {
    setConfig,
    type ReportConfigOptions,
} from "./config.js";
import { addCache, clearCache, getCache } from "./cache.js";

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

let lifecycleWindow: Window | undefined;

// SDK 安装前保存原始 XHR 方法，避免监控 XHR 包装器再次捕获上报请求。
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
export function imgRequest(data: string): boolean {
    if (typeof Image === "undefined") {
        return false;
    }

    const image = new Image();
    const separator = config.url.includes("?") ? "&" : "?";
    image.src = `${config.url}${separator}data=${encodeURIComponent(data)}`;
    return true;
}

/**
 * 通过 sendBeacon 同步提交上报载荷，并返回浏览器是否接受了数据。
 */
export function beaconRequest(data: string): boolean {
    if (!isSupportSendBeacon()) {
        return false;
    }

    try {
        return navigator.sendBeacon(config.url, data);
    } catch {
        return false;
    }
}

/**
 * 使用监控安装前保存的 XHR 方法发送载荷，避免采集上报请求自身。
 */
export function xhrRequest(data: string): boolean {
    if (
        typeof XMLHttpRequest === "undefined" ||
        !originalOpen ||
        !originalSend
    ) {
        return false;
    }

    schedule(() => {
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
    return true;
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
        return imgRequest(reportData);
    }
    if (isSupportSendBeacon()) {
        return beaconRequest(reportData);
    }
    if (typeof XMLHttpRequest !== "undefined" && originalOpen && originalSend) {
        return xhrRequest(reportData);
    }
    return false;
}

function flushQueue(): boolean {
    // 先读取快照，只有传输被接受后才清理缓存，避免失败时丢数据。
    const batch = getCache();
    if (batch.length === 0) {
        return false;
    }

    if (!report(batch)) {
        return false;
    }
    clearCache();
    return true;
}

function installLifecycleFlush(): void {
    if (
        typeof window === "undefined" ||
        typeof window.addEventListener !== "function" ||
        lifecycleWindow === window
    ) {
        return;
    }

    // 每个 Window 只注册一次，避免重复初始化 SDK 时重复发送同一批数据。
    lifecycleWindow = window;
    window.addEventListener("pagehide", flushQueue);
    const documentTarget = window.document;
    if (documentTarget) {
        // 页面隐藏或卸载前，优先把未达到批量阈值的数据发送出去。
        documentTarget.addEventListener("visibilitychange", () => {
            if (documentTarget.visibilityState === "hidden") {
                flushQueue();
            }
        });
    }
}

/**
 * 缓存监控数据，并在达到配置的批量大小时统一上报。
 */
export function lazyReportBatch(data: unknown): boolean {
    if (!config.url) {
        return false;
    }

    installLifecycleFlush();
    addCache(data);
    // batchSize 为 0 时按单条上报处理，避免数据永远留在缓存中。
    const batchSize = Math.max(1, config.batchSize);
    if (getCache().length < batchSize) {
        return false;
    }

    return flushQueue();
}

/**
 * 立即上报当前缓存中的数据，不足一个批次的数据也会被发送。
 */
export function flushReportQueue(): boolean {
    return flushQueue();
}

/**
 * 清空尚未达到批量阈值的待上报数据。
 */
export function clearReportQueue(): void {
    clearCache();
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
                // 统一处理器将数据加入缓存，达到阈值后再批量发送。
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
    // 监控模块会直接加入批量缓存；这里只返回调用方回调，避免重复入队。
    return options.onReport;
}
