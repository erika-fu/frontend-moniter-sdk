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
