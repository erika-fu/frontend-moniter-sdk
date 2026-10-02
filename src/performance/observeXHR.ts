/**
 * XHR 请求性能上报数据。
 */
export interface XHRReportData {
    /** HTTP 响应状态码。 */
    status: number;
    /** 请求总耗时，单位为毫秒。 */
    duration: number;
    /** 请求开始时间（Unix 时间戳），单位为毫秒。 */
    startTime: number;
    /** 请求结束时间（Unix 时间戳），单位为毫秒。 */
    endTime: number;
    /** 请求地址。 */
    url: string;
    /** 大写形式的 HTTP 请求方法。 */
    method: string;
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "xhr";
    /** 状态码是否表示请求成功。 */
    success: boolean;
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

export type XHRReportHandler = (reportData: XHRReportData) => void;

interface RequestMetadata {
    method: string;
    url: string;
}

let observedPrototype: XMLHttpRequest | undefined;
let originalOpen: XMLHttpRequest["open"] | undefined;
let originalSend: XMLHttpRequest["send"] | undefined;
let wrappedOpen: XMLHttpRequest["open"] | undefined;
let wrappedSend: XMLHttpRequest["send"] | undefined;
let reportHandler: XHRReportHandler | undefined;

/**
 * 监听通过 XMLHttpRequest 发起的请求。
 *
 * 浏览器环境中的 axios 默认使用 XMLHttpRequest，因此也会被该监听器
 * 采集。重复调用只会更新上报回调，不会重复包装原型方法。
 */
export function observeXHR(onReport?: XHRReportHandler): void {
    if (typeof XMLHttpRequest === "undefined") {
        return;
    }

    const prototype = XMLHttpRequest.prototype;
    if (
        observedPrototype === prototype &&
        prototype.open === wrappedOpen &&
        prototype.send === wrappedSend
    ) {
        reportHandler = onReport;
        return;
    }

    stopObserveXHR();
    reportHandler = onReport;

    const requestMetadata = new WeakMap<XMLHttpRequest, RequestMetadata>();
    const open = prototype.open;
    const send = prototype.send;

    const openWrapper = function (
        this: XMLHttpRequest,
        ...args: unknown[]
    ): void {
        const method = typeof args[0] === "string" ? args[0] : "";
        const url =
            typeof args[1] === "string" || args[1] instanceof URL
                ? String(args[1])
                : "";

        requestMetadata.set(this, { method, url });
        Reflect.apply(open, this, args);
    } as XMLHttpRequest["open"];

    const sendWrapper = function (
        this: XMLHttpRequest,
        ...args: Parameters<XMLHttpRequest["send"]>
    ): void {
        const startTime = Date.now();
        let completed = false;

        const onLoadEnd = () => {
            if (completed) {
                return;
            }
            completed = true;

            const endTime = Date.now();
            const metadata = requestMetadata.get(this);
            const status = this.status;
            const reportData: XHRReportData = {
                status,
                duration: endTime - startTime,
                startTime,
                endTime,
                url: metadata?.url ?? "",
                method: (metadata?.method ?? "").toUpperCase(),
                type: "performance",
                subType: "xhr",
                success: status >= 200 && status < 300,
                pageUrl:
                    typeof window === "undefined"
                        ? ""
                        : window.location.href,
            };

            this.removeEventListener("loadend", onLoadEnd, true);
            requestMetadata.delete(this);

            // 监控逻辑不能因上报回调异常而影响业务请求。
            try {
                reportHandler?.(reportData);
            } catch {
                // 等统一上报模块接入后，由上报模块处理自身异常。
            }
        };

        this.addEventListener("loadend", onLoadEnd, true);

        try {
            Reflect.apply(send, this, args);
        } catch (error) {
            this.removeEventListener("loadend", onLoadEnd, true);
            requestMetadata.delete(this);
            throw error;
        }
    } as XMLHttpRequest["send"];

    observedPrototype = prototype;
    originalOpen = open;
    originalSend = send;
    wrappedOpen = openWrapper;
    wrappedSend = sendWrapper;
    prototype.open = openWrapper;
    prototype.send = sendWrapper;
}

/**
 * 停止监听并恢复安装监听器之前的 XHR 原型方法。
 */
export function stopObserveXHR(): void {
    if (observedPrototype) {
        if (observedPrototype.open === wrappedOpen && originalOpen) {
            observedPrototype.open = originalOpen;
        }
        if (observedPrototype.send === wrappedSend && originalSend) {
            observedPrototype.send = originalSend;
        }
    }

    observedPrototype = undefined;
    originalOpen = undefined;
    originalSend = undefined;
    wrappedOpen = undefined;
    wrappedSend = undefined;
    reportHandler = undefined;
}
