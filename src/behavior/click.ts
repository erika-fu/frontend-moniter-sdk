import { dispatchReport } from "../report.js";
import { getSerializableEventPath } from "../eventPath.js";

export type ClickEventType = "click";

/**
 * 用户点击上报数据。
 */
export interface ClickReportData {
    /** 监控数据的一级分类。 */
    type: "behavior";
    /** 监控数据的二级分类。 */
    subType: "click";
    /** 命中允许列表属性的目标元素标签名。 */
    target: string;
    /** 事件相对于当前页面时间原点的毫秒数。 */
    startTime: number;
    /** 目标元素的布局宽度，单位为 CSS 像素。 */
    width: number;
    /** 目标元素的布局高度，单位为 CSS 像素。 */
    height: number;
    /** 触发采集的原始事件类型。 */
    eventType: ClickEventType;
    /** 目标元素上命中的允许列表属性及其值。 */
    attributes: Record<string, string>;
    /** 事件传播路径；运行环境不支持时不提供。 */
    path?: string[];
}

export type ClickReportHandler = (reportData: ClickReportData) => void;

/**
 * 点击监听配置。
 */
export interface ClickMonitoringOptions {
    /** 接收点击监控数据。 */
    onReport?: ClickReportHandler;
    /**
     * 允许上报的 DOM 属性名列表。
     *
     * 省略或规范化后为空时不安装点击监听器、不上报点击。
     * 传入数组会被复制并做去空白、去重处理。
     */
    clickAttributes?: string[];
}

interface ClickTarget extends EventTarget {
    tagName: string;
    offsetWidth?: number;
    offsetHeight?: number;
    hasAttribute(name: string): boolean;
    getAttribute(name: string): string | null;
}

let observedWindow: Window | undefined;
let reportHandler: ClickReportHandler | undefined;
let allowedAttributes: string[] = [];
let clickHandler: ((event: Event) => void) | undefined;

/**
 * 复制、修剪空白并去重属性名；忽略非字符串与空名称。
 */
function normalizeClickAttributes(
    attributes: readonly unknown[] | undefined,
): string[] {
    if (!attributes) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();

    for (const value of attributes) {
        if (typeof value !== "string") {
            continue;
        }

        const name = value.trim();
        if (!name || seen.has(name)) {
            continue;
        }

        seen.add(name);
        normalized.push(name);
    }

    return normalized;
}

function isClickTarget(target: EventTarget | null): target is ClickTarget {
    return (
        target !== null &&
        typeof target === "object" &&
        "tagName" in target &&
        typeof (target as { tagName?: unknown }).tagName === "string" &&
        typeof (target as { hasAttribute?: unknown }).hasAttribute ===
            "function" &&
        typeof (target as { getAttribute?: unknown }).getAttribute ===
            "function"
    );
}

function getEventPath(event: Event): EventTarget[] {
    const legacyEvent = event as Event & { path?: EventTarget[] };
    if (typeof event.composedPath === "function") {
        return event.composedPath();
    }
    return legacyEvent.path ?? [];
}

function findMarkedTarget(
    event: Event,
    attributes: readonly string[],
): ClickTarget | undefined {
    for (const node of getEventPath(event)) {
        if (!isClickTarget(node)) {
            continue;
        }

        for (const name of attributes) {
            if (node.hasAttribute(name)) {
                return node;
            }
        }
    }

    return undefined;
}

function collectAllowedAttributes(
    target: ClickTarget,
    attributes: readonly string[],
): Record<string, string> {
    const matched: Record<string, string> = {};

    for (const name of attributes) {
        if (target.hasAttribute(name)) {
            matched[name] = target.getAttribute(name) ?? "";
        }
    }

    return matched;
}

function handleClick(event: Event): void {
    if (allowedAttributes.length === 0) {
        return;
    }

    const target = findMarkedTarget(event, allowedAttributes);
    if (!target) {
        return;
    }

    const path = getSerializableEventPath(event);

    dispatchReport(
        {
            type: "behavior",
            subType: "click",
            target: target.tagName,
            startTime: event.timeStamp,
            width: target.offsetWidth ?? 0,
            height: target.offsetHeight ?? 0,
            eventType: "click",
            attributes: collectAllowedAttributes(target, allowedAttributes),
            ...(path ? { path } : {}),
        },
        reportHandler,
    );
}

function detachClickListener(): void {
    if (observedWindow && clickHandler) {
        observedWindow.removeEventListener("click", clickHandler, true);
    }

    observedWindow = undefined;
    clickHandler = undefined;
}

/**
 * 按属性允许列表监听捕获阶段的 `click` 事件。
 *
 * 未配置或规范化后为空时不安装监听器。重复调用会更新回调与允许列表，
 * 不会重复安装监听器；允许列表变空时移除已有监听器。
 */
export function observeClick(options: ClickMonitoringOptions = {}): void {
    if (
        typeof window === "undefined" ||
        typeof window.addEventListener !== "function"
    ) {
        return;
    }

    reportHandler = options.onReport;
    allowedAttributes = normalizeClickAttributes(options.clickAttributes);

    if (allowedAttributes.length === 0) {
        detachClickListener();
        return;
    }

    if (observedWindow === window && clickHandler) {
        return;
    }

    detachClickListener();
    observedWindow = window;
    clickHandler = handleClick;
    observedWindow.addEventListener("click", clickHandler, true);
}

/**
 * 移除点击监听器并释放保存的回调与允许列表。
 */
export function stopObserveClick(): void {
    detachClickListener();
    reportHandler = undefined;
    allowedAttributes = [];
}

export default observeClick;
