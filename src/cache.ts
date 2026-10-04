type CacheValue = object | unknown[];

const cache: unknown[] = [];

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
    return cache.map((item) => clone(item)) as T[];
}

export function addCache<T>(data: T): void {
    cache.push(clone(data));
}

export function clearCache(): void {
    cache.length = 0;
}
