/**
 * Fetch 请求性能上报数据。
 */
export interface FetchReportData {
    /** HTTP 响应状态码；网络错误时为 0。 */
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
    subType: "fetch";
    /** Fetch 响应的 ok 状态。 */
    success: boolean;
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

export type FetchReportHandler = (reportData: FetchReportData) => void;

interface FetchOwner {
    fetch: typeof fetch;
}

let observedOwner: FetchOwner | undefined;
let originalFetch: typeof fetch | undefined;
let wrappedFetch: typeof fetch | undefined;
let reportHandler: FetchReportHandler | undefined;

function getRequestDetails(
    input: RequestInfo | URL,
    init?: RequestInit,
): { method: string; url: string } {
    const request =
        typeof Request !== "undefined" && input instanceof Request
            ? input
            : undefined;

    return {
        method: (init?.method ?? request?.method ?? "GET").toUpperCase(),
        url: request?.url ?? String(input),
    };
}

function reportFetch(reportData: FetchReportData): void {
    // 监控逻辑不能因上报回调异常而改变 Fetch Promise 的状态。
    try {
        reportHandler?.(reportData);
    } catch {
        // 等统一上报模块接入后，由上报模块处理自身异常。
    }
}

/**
 * 监听通过 window.fetch 发起的请求。
 *
 * 成功响应和网络异常都会产生性能数据。重复调用只会更新上报回调，
 * 不会重复包装 fetch。
 */
export function observeFetch(onReport?: FetchReportHandler): void {
    if (typeof window === "undefined" || typeof window.fetch !== "function") {
        return;
    }

    const owner: FetchOwner = window;
    if (observedOwner === owner && owner.fetch === wrappedFetch) {
        reportHandler = onReport;
        return;
    }

    stopObserveFetch();
    reportHandler = onReport;

    const fetchFunction = owner.fetch;
    const fetchWrapper = async function (
        this: unknown,
        ...args: Parameters<typeof fetch>
    ): Promise<Response> {
        const input = args[0];
        const init = args[1];
        const startTime = Date.now();
        const { method, url } = getRequestDetails(input, init);

        try {
            const response = await Reflect.apply(
                fetchFunction,
                this,
                args,
            );
            const endTime = Date.now();

            reportFetch({
                status: response.status,
                duration: endTime - startTime,
                startTime,
                endTime,
                url,
                method,
                type: "performance",
                subType: "fetch",
                success: response.ok,
                pageUrl: window.location.href,
            });

            return response;
        } catch (error) {
            const endTime = Date.now();

            reportFetch({
                status: 0,
                duration: endTime - startTime,
                startTime,
                endTime,
                url,
                method,
                type: "performance",
                subType: "fetch",
                success: false,
                pageUrl: window.location.href,
            });

            throw error;
        }
    } as typeof fetch;

    observedOwner = owner;
    originalFetch = fetchFunction;
    wrappedFetch = fetchWrapper;
    owner.fetch = fetchWrapper;
}

/**
 * 停止监听并恢复安装监听器之前的 window.fetch。
 */
export function stopObserveFetch(): void {
    if (
        observedOwner &&
        observedOwner.fetch === wrappedFetch &&
        originalFetch
    ) {
        observedOwner.fetch = originalFetch;
    }

    observedOwner = undefined;
    originalFetch = undefined;
    wrappedFetch = undefined;
    reportHandler = undefined;
}
