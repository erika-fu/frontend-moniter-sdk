import { report } from "../report.js";

/**
 * 执行性能数据回调，并隔离上报逻辑自身的异常。
 */
export function reportSafely<T>(
    handler: ((reportData: T) => void) | undefined,
    reportData: T,
): void {
    // 所有性能数据都先通过统一 report 函数传输。
    report(reportData);
    try {
        handler?.(reportData);
    } catch {
        // 上报失败不能影响被监控页面的业务逻辑。
    }
}
