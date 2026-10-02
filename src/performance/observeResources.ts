import { reportSafely } from "./reportSafely.js";

/**
 * 资源加载上报数据。
 */
export interface ResourceLoadReportData {
    /** 资源地址。 */
    name: string;
    /** 监控数据的一级分类。 */
    type: "performance";
    /** 监控数据的二级分类。 */
    subType: "resource";
    /** 发起资源请求的元素或 API 类型。 */
    sourceType: string;
    /** 资源加载总耗时，单位为毫秒。 */
    duration: number;
    /** DNS 查询耗时，单位为毫秒。 */
    dns: number;
    /** TCP 连接耗时，单位为毫秒。 */
    tcp: number;
    /** 重定向耗时，单位为毫秒。 */
    redirect: number;
    /** 从发起请求到收到首字节的耗时，单位为毫秒。 */
    ttfb: number;
    /** 资源传输使用的网络协议。 */
    protocol: string;
    /** 压缩后的响应体大小，单位为字节。 */
    responseBodySize: number;
    /** 响应头部大小，单位为字节。 */
    responseHeaderSize: number;
    /** 响应头部和响应体的传输大小，单位为字节。 */
    transferSize: number;
    /** 解压后的资源大小，单位为字节。 */
    resourceSize: number;
    /** 资源请求相对于页面时间原点的开始时间，单位为毫秒。 */
    startTime: number;
    /** 产生该性能数据的页面地址。 */
    pageUrl: string;
}

/**
 * 读取页面加载阶段已经缓存的 Resource Timing 条目。
 *
 * 每个资源会被转换为包含网络阶段耗时和传输大小的待上报数据。当前批次
 * 处理完成后停止观察，避免未来接入上报接口时把上报请求本身重复采集。
 */
function observeLoadedResources(
    onReport?: (reportData: ResourceLoadReportData) => void,
): void {
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (entry.entryType !== "resource") {
                continue;
            }

            const resourceEntry = entry as PerformanceResourceTiming;
            const reportData: ResourceLoadReportData = {
                name: resourceEntry.name,
                type: "performance",
                subType: "resource",
                sourceType: resourceEntry.initiatorType,
                duration: resourceEntry.duration,
                dns:
                    resourceEntry.domainLookupEnd -
                    resourceEntry.domainLookupStart,
                tcp: resourceEntry.connectEnd - resourceEntry.connectStart,
                redirect:
                    resourceEntry.redirectEnd - resourceEntry.redirectStart,
                ttfb:
                    resourceEntry.responseStart - resourceEntry.requestStart,
                protocol: resourceEntry.nextHopProtocol,
                responseBodySize: resourceEntry.encodedBodySize,
                responseHeaderSize:
                    resourceEntry.transferSize -
                    resourceEntry.encodedBodySize,
                transferSize: resourceEntry.transferSize,
                resourceSize: resourceEntry.decodedBodySize,
                startTime: resourceEntry.startTime,
                pageUrl: window.location.href,
            };

            reportSafely(onReport, reportData);
        }

        // 页面首轮资源条目处理完成后停止观察，避免采集上报请求本身。
        observer.disconnect();
    });

    observer.observe({
        type: "resource",
        buffered: true,
    });
}

/**
 * 页面加载完成后采集首轮资源加载性能数据。
 *
 * 如果调用时页面尚未加载完成，则等待一次 load 事件，确保首轮资源条目
 * 已经进入 Performance Timeline；buffered 模式负责取回此前产生的条目。
 */
export function observeResources(
    onReport?: (reportData: ResourceLoadReportData) => void,
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof PerformanceObserver === "undefined"
    ) {
        return;
    }

    if (document.readyState === "complete") {
        observeLoadedResources(onReport);
        return;
    }

    // load 后只采集一次，并及时移除事件监听器。
    const onLoad = () => {
        observeLoadedResources(onReport);
        window.removeEventListener("load", onLoad, true);
    };
    window.addEventListener("load", onLoad, true);
}
