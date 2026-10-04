import { dispatchReport } from "../report.js";
import { getSerializableEventPath } from "../eventPath.js";

export type ClickEventType = "mousedown" | "touchstart";

/**
 * 用户点击或触摸上报数据。
 */
export interface ClickReportData {
    /** 监控数据的一级分类。 */
    type: "behavior";
    /** 监控数据的二级分类。 */
    subType: "click";
    /** 事件目标的 HTML 标签名。 */
    target: string;
    /** 事件相对于当前页面时间原点的毫秒数。 */
    startTime: number;
    /** 事件目标的内部 HTML。 */
    innerHtml: string;
    /** 事件目标自身及其内部内容的 HTML。 */
    outerHtml: string;
    /** 事件目标的布局宽度，单位为 CSS 像素。 */
    width: number;
    /** 事件目标的布局高度，单位为 CSS 像素。 */
    height: number;
    /** 触发采集的原始事件类型。 */
    eventType: ClickEventType;
    /** 事件传播路径；运行环境不支持时不提供。 */
    path?: string[];
}

export type ClickReportHandler = (reportData: ClickReportData) => void;

interface ClickTarget extends EventTarget {
    tagName: string;
    innerHTML?: string;
    outerHTML?: string;
    offsetWidth?: number;
    offsetHeight?: number;
}

let observedWindow: Window | undefined;
let reportHandler: ClickReportHandler | undefined;
let mouseDownHandler: ((event: Event) => void) | undefined;
let touchStartHandler: ((event: Event) => void) | undefined;

function isClickTarget(target: EventTarget | null): target is ClickTarget {
    return (
        target !== null &&
        "tagName" in target &&
        typeof (target as { tagName?: unknown }).tagName === "string"
    );
}

function handleInteraction(eventType: ClickEventType, event: Event): void {
    if (!isClickTarget(event.target)) {
        return;
    }

    const path = getSerializableEventPath(event);
    const target = event.target;

    dispatchReport(
        {
            type: "behavior",
            subType: "click",
            target: target.tagName,
            startTime: event.timeStamp,
            innerHtml: target.innerHTML ?? "",
            outerHtml: target.outerHTML ?? "",
            width: target.offsetWidth ?? 0,
            height: target.offsetHeight ?? 0,
            eventType,
            ...(path ? { path } : {}),
        },
        reportHandler,
    );
}

/**
 * 监听鼠标按下和触摸开始事件。
 *
 * 使用捕获阶段可在业务代码停止事件传播前完成采集。重复调用只更新回调，
 * 不会重复安装监听器。
 */
export function observeClick(onReport?: ClickReportHandler): void {
    if (
        typeof window === "undefined" ||
        typeof window.addEventListener !== "function"
    ) {
        return;
    }

    if (observedWindow === window) {
        reportHandler = onReport;
        return;
    }

    stopObserveClick();
    observedWindow = window;
    reportHandler = onReport;
    mouseDownHandler = (event: Event) =>
        handleInteraction("mousedown", event);
    touchStartHandler = (event: Event) =>
        handleInteraction("touchstart", event);

    observedWindow.addEventListener("mousedown", mouseDownHandler, true);
    observedWindow.addEventListener("touchstart", touchStartHandler, true);
}

/**
 * 移除用户交互监听器并释放保存的回调。
 */
export function stopObserveClick(): void {
    if (observedWindow && mouseDownHandler) {
        observedWindow.removeEventListener(
            "mousedown",
            mouseDownHandler,
            true,
        );
    }
    if (observedWindow && touchStartHandler) {
        observedWindow.removeEventListener(
            "touchstart",
            touchStartHandler,
            true,
        );
    }

    observedWindow = undefined;
    reportHandler = undefined;
    mouseDownHandler = undefined;
    touchStartHandler = undefined;
}

export default observeClick;
