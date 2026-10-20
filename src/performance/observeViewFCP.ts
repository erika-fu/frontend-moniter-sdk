import {
    getActivePageView,
    type PageViewStartSource,
} from "../behavior/pv.js";
import { dispatchReport } from "../report.js";

/**
 * 判定 View Paint 内容绘制时刻的机制。
 */
export type ViewPaintMeasurementSource =
    | "application-mark"
    | "declared-content";

/**
 * View First Contentful Paint 上报数据。
 *
 * 与文档级 `first-contentful-paint` 相互独立；`value` 为相对 View Start 的毫秒数。
 */
export interface ViewFirstContentfulPaintReportData {
    type: "performance";
    subType: "view-first-contentful-paint";
    name: "VFCP";
    value: number;
    pageUrl: string;
    viewId: string;
    measurementSource: ViewPaintMeasurementSource;
    startSource: PageViewStartSource;
    pageName?: string;
    routePattern?: string;
}

export type ViewFirstContentfulPaintReportHandler = (
    reportData: ViewFirstContentfulPaintReportData,
) => void;

const reportedViewIds = new Set<string>();

let declaredObserver: MutationObserver | undefined;
let declaredRoot: Element | undefined;
let declaredOnReport: ViewFirstContentfulPaintReportHandler | undefined;

function disconnectDeclaredObserver(): void {
    declaredObserver?.disconnect();
    declaredObserver = undefined;
    declaredRoot = undefined;
    declaredOnReport = undefined;
}

/**
 * 停止声明内容观察。已上报的 `viewId` 集合保留，保证同一 Page View 不会再次上报。
 */
export function stopObserveViewFirstContentfulPaint(): void {
    disconnectDeclaredObserver();
}

/**
 * 清除已上报的 viewId 集合并停止观察（测试与完整重启）。
 */
export function resetViewFirstContentfulPaint(): void {
    reportedViewIds.clear();
    disconnectDeclaredObserver();
}

function emitViewFCP(
    measurementSource: ViewPaintMeasurementSource,
    onReport?: ViewFirstContentfulPaintReportHandler,
): boolean {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined"
    ) {
        return false;
    }

    const pageView = getActivePageView();
    if (!pageView || reportedViewIds.has(pageView.viewId)) {
        return false;
    }

    const value = performance.now() - pageView.startTime;
    if (!Number.isFinite(value) || value < 0) {
        return false;
    }

    reportedViewIds.add(pageView.viewId);
    const reportData: ViewFirstContentfulPaintReportData = {
        type: "performance",
        subType: "view-first-contentful-paint",
        name: "VFCP",
        value,
        pageUrl: pageView.pageUrl,
        viewId: pageView.viewId,
        measurementSource,
        startSource: pageView.startSource,
        ...(pageView.pageName !== undefined
            ? { pageName: pageView.pageName }
            : {}),
        ...(pageView.routePattern !== undefined
            ? { routePattern: pageView.routePattern }
            : {}),
    };
    dispatchReport(reportData, onReport);
    return true;
}

/**
 * 业务显式标记：当前 Page View 的有意义内容已可见。
 *
 * Measurement Source 为 `application-mark`。每个 `viewId` 最多上报一次。
 * 调用方应在真实内容就绪时标记；勿在仅有 skeleton / spinner / placeholder 时调用。
 */
export function markViewFirstContentfulPaint(
    onReport?: ViewFirstContentfulPaintReportHandler,
): void {
    emitViewFCP("application-mark", onReport);
}

function isExcludedContent(element: Element): boolean {
    return (
        element.hasAttribute("data-view-skeleton") ||
        element.hasAttribute("data-view-placeholder") ||
        element.hasAttribute("data-view-spinner")
    );
}

function isMeaningfulDeclaredContent(node: Node): node is Element {
    if (!(node instanceof Element)) {
        return false;
    }
    const pageView = getActivePageView();
    if (!pageView || pageView.retainedNodes.has(node) || isExcludedContent(node)) {
        return false;
    }
    if (!node.hasAttribute("data-view-content")) {
        return false;
    }
    const text = node.textContent?.trim() ?? "";
    if (text.length === 0 && !node.querySelector("img,svg,canvas,video")) {
        return false;
    }
    return true;
}

function scanDeclaredContent(): void {
    if (!declaredRoot) {
        return;
    }
    const candidates = [
        declaredRoot,
        ...declaredRoot.querySelectorAll("[data-view-content]"),
    ];
    for (const candidate of candidates) {
        if (isMeaningfulDeclaredContent(candidate)) {
            if (emitViewFCP("declared-content", declaredOnReport)) {
                disconnectDeclaredObserver();
            }
            return;
        }
    }
}

export interface ObserveViewFirstContentfulPaintOptions {
    /** 声明的内容区域；省略时使用 `document.body`。 */
    root?: Element | string;
    onReport?: ViewFirstContentfulPaintReportHandler;
}

/**
 * 观察声明内容区：首个带 `data-view-content` 且非 skeleton / placeholder /
 * spinner / 空节点 / View Start 前已存在节点的元素出现时上报。
 *
 * Measurement Source 为 `declared-content`。每个 `viewId` 最多上报一次。
 * 时刻取自 DOM 变更后的 `performance.now()`，近似而非浏览器 paint 时间戳。
 */
export function observeViewFirstContentfulPaint(
    options: ObserveViewFirstContentfulPaintOptions = {},
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof MutationObserver === "undefined"
    ) {
        return;
    }

    disconnectDeclaredObserver();

    const root =
        typeof options.root === "string"
            ? document.querySelector(options.root)
            : options.root ?? document.body;
    if (!root) {
        return;
    }

    declaredRoot = root;
    declaredOnReport = options.onReport;

    const pageView = getActivePageView();
    if (!pageView || reportedViewIds.has(pageView.viewId)) {
        return;
    }

    scanDeclaredContent();
    if (!reportedViewIds.has(pageView.viewId)) {
        declaredObserver = new MutationObserver(() => {
            scanDeclaredContent();
        });
        declaredObserver.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        });
    }
}

export default observeViewFirstContentfulPaint;
