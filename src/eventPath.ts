function describeEventTarget(target: EventTarget): string {
    if (typeof window !== "undefined" && target === window) {
        return "Window";
    }
    if (typeof document !== "undefined" && target === document) {
        return "Document";
    }

    const node = target as EventTarget & {
        tagName?: unknown;
        nodeName?: unknown;
    };
    if (typeof node.tagName === "string") {
        return node.tagName;
    }
    if (typeof node.nodeName === "string") {
        return node.nodeName;
    }

    return target.constructor?.name || "EventTarget";
}

/**
 * 将事件传播路径转换为可序列化的节点名称，避免缓存 DOM 对象。
 */
export function getSerializableEventPath(
    event: Event,
): string[] | undefined {
    const legacyEvent = event as Event & { path?: EventTarget[] };
    const eventPath =
        typeof event.composedPath === "function"
            ? event.composedPath()
            : legacyEvent.path;

    return eventPath?.map(describeEventTarget);
}
