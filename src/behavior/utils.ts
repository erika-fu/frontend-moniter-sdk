/**
 * 生成行为数据标识。
 *
 * 优先使用浏览器提供的 UUID；旧环境中使用时间戳和随机数降级，
 * 保证同一页面内的行为数据仍可被区分。
 */
export function generateBehaviorId(): string {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    ) {
        return crypto.randomUUID();
    }

    return `behavior-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 隔离上报回调异常，避免监控代码影响宿主页面的交互和路由。
 */
export function reportSafely<T>(
    onReport: ((reportData: T) => void) | undefined,
    reportData: T,
): void {
    try {
        onReport?.(reportData);
    } catch {
        // 上报失败不能中断宿主页面原有的事件处理流程。
    }
}
