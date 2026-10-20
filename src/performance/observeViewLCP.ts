import {
    getActivePageView,
    subscribeActivePageView,
    type PageViewStartSource,
} from "../behavior/pv.js";
import { dispatchReport } from "../report.js";

/**
 * 结束 View Largest Contentful Paint 观察的原因。
 *
 * `timeout` 只结束观察；它不会被写成指标值。
 */
export type ViewLargestContentfulPaintFinalizationReason =
    | "interaction"
    | "page-hidden"
    | "next-page-view"
    | "timeout";

/**
 * 判定 View Largest Contentful Paint 绘制时刻的机制。
 */
export type ViewLargestContentfulPaintMeasurementSource = "declared-region";

/**
 * View Largest Contentful Paint 上报数据。
 *
 * 与文档级 `largest-contentful-paint` 相互独立；`value` 为相对 View Start 的毫秒数。
 * 候选项在最终确定前只保留在本地，每个 `viewId` 最多上报一次。
 */
export interface ViewLargestContentfulPaintReportData {
    type: "performance";
    subType: "view-largest-contentful-paint";
    name: "VLCP";
    value: number;
    pageUrl: string;
    viewId: string;
    measurementSource: ViewLargestContentfulPaintMeasurementSource;
    startSource: PageViewStartSource;
    finalizationReason: ViewLargestContentfulPaintFinalizationReason;
    pageName?: string;
    routePattern?: string;
}

export type ViewLargestContentfulPaintReportHandler = (
    reportData: ViewLargestContentfulPaintReportData,
) => void;

export interface ObserveViewLargestContentfulPaintOptions {
    /** 首屏内容区；省略时使用 `document.body`。 */
    root?: Element | string;
    /**
     * 观察超时（毫秒）。到期后若已有合格候选则以其绘制时刻最终确定；
     * 超时时长本身不会成为 `value`。默认 10 秒。
     */
    timeout?: number;
    onReport?: ViewLargestContentfulPaintReportHandler;
}

const DEFAULT_VIEW_LCP_TIMEOUT_MS = 10_000;
const MEDIA_TAGS = new Set(["IMG", "SVG", "CANVAS", "VIDEO"]);
const SHARED_REGION_SELECTOR = [
    "[data-view-navigation]",
    "[data-view-overlay]",
    "[data-view-advertising]",
    "[data-view-recommendation]",
].join(",");
const NON_CONTENT_SELECTOR = [
    "[data-view-skeleton]",
    "[data-view-placeholder]",
    "[data-view-spinner]",
].join(",");

const reportedViewIds = new Set<string>();

interface BoundView {
    viewId: string;
    startTime: number;
    startSource: PageViewStartSource;
    pageUrl: string;
    pageName?: string;
    routePattern?: string;
}

interface CandidatePaint {
    area: number;
    paintedAt: number;
}

let declaredObserver: MutationObserver | undefined;
let declaredRoot: Element | undefined;
let declaredOnReport: ViewLargestContentfulPaintReportHandler | undefined;
let boundView: BoundView | undefined;
let currentCandidate: CandidatePaint | undefined;
let timeoutId: ReturnType<typeof setTimeout> | undefined;
let unsubscribePageView: (() => void) | undefined;
let elementPaint = new WeakMap<Element, CandidatePaint>();

function removeFinalizationListeners(): void {
    if (typeof document?.removeEventListener === "function") {
        document.removeEventListener("pointerdown", onTrustedInteraction, true);
        document.removeEventListener("keydown", onTrustedInteraction, true);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window?.removeEventListener === "function") {
        window.removeEventListener("pagehide", onPageHide);
    }
    unsubscribePageView?.();
    unsubscribePageView = undefined;
    elementPaint = new WeakMap();
}

function disconnectObservation(): void {
    declaredObserver?.disconnect();
    declaredObserver = undefined;
    declaredRoot = undefined;
    declaredOnReport = undefined;
    boundView = undefined;
    currentCandidate = undefined;
    if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
    }
    removeFinalizationListeners();
}

/**
 * 停止观察且不上报。已上报的 `viewId` 集合保留。
 */
export function stopObserveViewLargestContentfulPaint(): void {
    disconnectObservation();
}

/**
 * 清除已上报的 viewId 集合并停止观察（测试与完整重启）。
 */
export function resetViewLargestContentfulPaint(): void {
    reportedViewIds.clear();
    disconnectObservation();
}

function explicitPx(value: string | null | undefined): number {
    if (!value) {
        return 0;
    }
    const match = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
    return match ? Number(match[1]) : 0;
}

function renderedArea(element: Element): number {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        return rect.width * rect.height;
    }
    const style = (element as HTMLElement).style;
    const width =
        explicitPx(style?.width) || Number(element.getAttribute("width"));
    const height =
        explicitPx(style?.height) || Number(element.getAttribute("height"));
    if (width > 0 && height > 0) {
        return width * height;
    }
    return 0;
}

function hasDirectText(element: Element): boolean {
    return [...element.childNodes].some(
        (node) =>
            node.nodeType === Node.TEXT_NODE &&
            Boolean(node.textContent?.trim()),
    );
}

function isExcludedSharedRegion(element: Element): boolean {
    const shared = element.closest(SHARED_REGION_SELECTOR);
    if (!shared) {
        return false;
    }
    const include = element.closest("[data-view-lcp-include]");
    return !(include !== null && shared.contains(include));
}

function isEligibleContent(element: Element): boolean {
    if (element.closest(NON_CONTENT_SELECTOR) || isExcludedSharedRegion(element)) {
        return false;
    }
    return MEDIA_TAGS.has(element.tagName) || hasDirectText(element);
}

function scanCandidates(): void {
    if (!declaredRoot || !boundView) {
        return;
    }
    const now = performance.now();
    const pageView = getActivePageView();
    let best: CandidatePaint | undefined;
    const elements: Element[] = [
        declaredRoot,
        ...declaredRoot.querySelectorAll("*"),
    ];
    for (const element of elements) {
        if (pageView?.retainedNodes.has(element) || !isEligibleContent(element)) {
            continue;
        }
        const area = renderedArea(element);
        if (area <= 0) {
            continue;
        }
        const previous = elementPaint.get(element);
        const paintedAt =
            previous !== undefined && area <= previous.area
                ? previous.paintedAt
                : now;
        const next = { area, paintedAt };
        elementPaint.set(element, next);
        if (best === undefined || area > best.area) {
            best = next;
        }
    }
    currentCandidate = best;
}

function finalize(
    reason: ViewLargestContentfulPaintFinalizationReason,
): void {
    if (!boundView || reportedViewIds.has(boundView.viewId)) {
        disconnectObservation();
        return;
    }
    if (!currentCandidate) {
        disconnectObservation();
        return;
    }
    const value = currentCandidate.paintedAt - boundView.startTime;
    if (!Number.isFinite(value) || value < 0) {
        disconnectObservation();
        return;
    }

    reportedViewIds.add(boundView.viewId);
    const reportData: ViewLargestContentfulPaintReportData = {
        type: "performance",
        subType: "view-largest-contentful-paint",
        name: "VLCP",
        value,
        pageUrl: boundView.pageUrl,
        viewId: boundView.viewId,
        measurementSource: "declared-region",
        startSource: boundView.startSource,
        finalizationReason: reason,
        ...(boundView.pageName !== undefined
            ? { pageName: boundView.pageName }
            : {}),
        ...(boundView.routePattern !== undefined
            ? { routePattern: boundView.routePattern }
            : {}),
    };
    const handler = declaredOnReport;
    disconnectObservation();
    dispatchReport(reportData, handler);
}

function onTrustedInteraction(event: Event): void {
    if (!event.isTrusted) {
        return;
    }
    finalize("interaction");
}

function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
        finalize("page-hidden");
    }
}

function onPageHide(): void {
    finalize("page-hidden");
}

function onNextPageView(pageView: { viewId: string }): void {
    if (boundView && pageView.viewId !== boundView.viewId) {
        finalize("next-page-view");
    }
}

/**
 * 观察声明的首屏内容区，跟踪其中最大的合格内容。
 *
 * 候选变化只保留在本地。可信交互、页面隐藏、下一次 Page View 或超时
 * 最终确定后，每个 `viewId` 最多上报一次。没有合格候选时不上报。
 * 面积优先取元素边框盒；边框盒为空时使用显式的 px 宽高。
 * `value` 是该最大候选首次达到当前面积时相对 View Start 的耗时，不是超时时长。
 */
export function observeViewLargestContentfulPaint(
    options: ObserveViewLargestContentfulPaintOptions = {},
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof MutationObserver === "undefined"
    ) {
        return;
    }

    disconnectObservation();

    const pageView = getActivePageView();
    if (!pageView || reportedViewIds.has(pageView.viewId)) {
        return;
    }

    const resolvedRoot =
        typeof options.root === "string"
            ? document.querySelector(options.root)
            : options.root ?? document.body;
    if (!resolvedRoot) {
        return;
    }

    declaredRoot = resolvedRoot;
    declaredOnReport = options.onReport;
    boundView = {
        viewId: pageView.viewId,
        startTime: pageView.startTime,
        startSource: pageView.startSource,
        pageUrl: pageView.pageUrl,
        ...(pageView.pageName !== undefined
            ? { pageName: pageView.pageName }
            : {}),
        ...(pageView.routePattern !== undefined
            ? { routePattern: pageView.routePattern }
            : {}),
    };

    document.addEventListener("pointerdown", onTrustedInteraction, true);
    document.addEventListener("keydown", onTrustedInteraction, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    unsubscribePageView = subscribeActivePageView(onNextPageView);

    const timeout = options.timeout ?? DEFAULT_VIEW_LCP_TIMEOUT_MS;
    if (Number.isFinite(timeout) && timeout >= 0) {
        timeoutId = setTimeout(() => {
            finalize("timeout");
        }, timeout);
    }

    scanCandidates();
    declaredObserver = new MutationObserver(() => {
        scanCandidates();
    });
    declaredObserver.observe(declaredRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
    });
}

export default observeViewLargestContentfulPaint;
