type CacheValue = object | unknown[];

// 缓存只在模块内部持有，避免调用方直接修改待上报数据。
const cache: unknown[] = [];

/**
 * 创建缓存数据的独立副本。
 *
 * 优先使用浏览器原生 structuredClone；部分数据（例如包含函数的对象）
 * 无法被原生克隆时，再使用递归方式处理普通对象、数组和循环引用。
 */
function clone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
    if (typeof value !== "object" || value === null) {
        return value;
    }

    if (typeof structuredClone === "function") {
        try {
            return structuredClone(value);
        } catch {
            // Fall back for values that structuredClone cannot handle.
        }
    }

    const object = value as CacheValue;
    if (seen.has(object)) {
        return seen.get(object) as T;
    }

    if (object instanceof Date) {
        return new Date(object.getTime()) as T;
    }
    if (object instanceof RegExp) {
        return new RegExp(object.source, object.flags) as T;
    }

    if (Array.isArray(object)) {
        const copy: unknown[] = [];
        seen.set(object, copy);
        for (const item of object) {
            copy.push(clone(item, seen));
        }
        return copy as T;
    }

    const copy = Object.create(
        Object.getPrototypeOf(object),
    ) as Record<string, unknown>;
    seen.set(object, copy);
    for (const [key, item] of Object.entries(object)) {
        copy[key] = clone(item, seen);
    }
    return copy as T;
}

export function getCache<T = unknown>(): T[] {
    // 每次读取都返回副本，防止组装上报载荷时修改内部缓存。
    return cache.map((item) => clone(item)) as T[];
}

export function addCache<T>(data: T): void {
    // 入缓存时先复制，避免调用方后续修改原始对象影响待上报内容。
    cache.push(clone(data));
}

export function clearCache(): void {
    // 通过修改数组长度保留缓存容器，避免替换模块内部引用。
    cache.length = 0;
}
