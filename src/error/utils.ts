import { lazyReportBatch } from "../report.js";

export function reportSafely<T>(
    onReport: ((reportData: T) => void) | undefined,
    reportData: T,
): void {
    // 所有运行时错误都进入统一批量缓存。
    lazyReportBatch(reportData);
    try {
        onReport?.(reportData);
    } catch {
        // 上报失败不能影响页面原有的错误处理流程。
    }
}

export function getPageUrl(): string {
    return typeof window !== "undefined" ? window.location.href : "";
}
