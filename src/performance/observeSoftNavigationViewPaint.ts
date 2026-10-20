import {
    getActivePageView,
    sanitizePageUrl,
    subscribeActivePageView,
    type ActivePageView,
} from "../behavior/pv.js";
import { dispatchReport } from "../report.js";
import type { ViewFirstContentfulPaintReportData } from "./observeViewFCP.js";
import type {
    ViewLargestContentfulPaintFinalizationReason,
    ViewLargestContentfulPaintReportData,
} from "./observeViewLCP.js";
import {
    hasClaimedViewPaint,
    releaseViewPaintFallback,
    resetViewPaintClaims,
    setSoftNavigationPreferred,
    tryEmitViewPaint,
} from "./viewPaintClaim.js";

/**
 * Soft Navigation API 支持探测结果。
 *
 * 完整支持时可作为 View Paint 的原生 Measurement Source；否则回退到容器观察与 application-mark。
 */
export type SoftNavigationSupportStatus =
    | { status: "supported" }
    | {
          status: "unsupported";
          reason:
              | "no-observer"
              | "type-rejected"
              | "partial"
              | "observe-failed";
      };

export type SoftNavigationViewFCPHandler = (
    reportData: ViewFirstContentfulPaintReportData,
) => void;

export type SoftNavigationViewLCPHandler = (
    reportData: ViewLargestContentfulPaintReportData,
) => void;

export interface ObserveSoftNavigationViewPaintOptions {
    onViewFCP?: SoftNavigationViewFCPHandler;
    onViewLCP?: SoftNavigationViewLCPHandler;
    /** VLCP 观察超时（毫秒）；超时只结束观察，不把超时时长写成 value。默认 10 秒。 */
    lcpTimeout?: number;
    /**
     * soft-navigation 优先等待窗口（毫秒）。到期仍无原生样本时释放
     * declared-* / application-mark 回退。默认 3 秒。
     */
    softNavWait?: number;
}

interface SoftNavigationLike extends PerformanceEntry {
    navigationId?: number;
    interactionId?: number;
    paintTime?: number;
    presentationTime?: number;
    getLargestInteractionContentfulPaint?: () => InteractionContentfulPaintLike | null;
}

interface InteractionContentfulPaintLike extends PerformanceEntry {
    interactionId?: number;
    largestContentfulPaint?: {
        startTime: number;
        size?: number;
        renderTime?: number;
        loadTime?: number;
    } | null;
}

interface BoundSoftLcp {
    viewId: string;
    startTime: number;
    startSource: ActivePageView["startSource"];
    pageUrl: string;
    pageName?: string;
    routePattern?: string;
    interactionId: number;
    navigationId?: number;
    paintedAt?: number;
    candidateSize: number;
}

const DEFAULT_LCP_TIMEOUT_MS = 10_000;
/** soft-navigation 优先等待窗口；到期仍无原生样本则释放低优先级回退。 */
const DEFAULT_SOFT_NAV_WAIT_MS = 3_000;

let supportStatus: SoftNavigationSupportStatus = {
    status: "unsupported",
    reason: "no-observer",
};
let softNavObserver: PerformanceObserver | undefined;
let icpObserver: PerformanceObserver | undefined;
let onViewFCP: SoftNavigationViewFCPHandler | undefined;
let onViewLCP: SoftNavigationViewLCPHandler | undefined;
let lcpTimeoutMs = DEFAULT_LCP_TIMEOUT_MS;
let softNavWaitMs = DEFAULT_SOFT_NAV_WAIT_MS;
let boundLcp: BoundSoftLcp | undefined;
let lcpTimeoutId: ReturnType<typeof setTimeout> | undefined;
let unsubscribePageView: (() => void) | undefined;
let waitingViewIds = new Set<string>();
const softNavWaitTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearSoftNavWait(viewId: string): void {
    const timer = softNavWaitTimers.get(viewId);
    if (timer !== undefined) {
        clearTimeout(timer);
        softNavWaitTimers.delete(viewId);
    }
}

function clearAllSoftNavWaits(): void {
    for (const timer of softNavWaitTimers.values()) {
        clearTimeout(timer);
    }
    softNavWaitTimers.clear();
}

function scheduleSoftNavWait(viewId: string): void {
    if (softNavWaitTimers.has(viewId)) {
        return;
    }
    if (!Number.isFinite(softNavWaitMs) || softNavWaitMs < 0) {
        return;
    }
    softNavWaitTimers.set(
        viewId,
        setTimeout(() => {
            softNavWaitTimers.delete(viewId);
            waitingViewIds.delete(viewId);
            releaseViewPaintFallback("view-first-contentful-paint", viewId);
            releaseViewPaintFallback("view-largest-contentful-paint", viewId);
        }, softNavWaitMs),
    );
}

function urlsMatch(left: string, right: string): boolean {
    try {
        return sanitizePageUrl(left) === sanitizePageUrl(right);
    } catch {
        return left === right;
    }
}

function paintMoment(entry: SoftNavigationLike): number | undefined {
    const presentation = entry.presentationTime;
    if (typeof presentation === "number" && Number.isFinite(presentation)) {
        return presentation;
    }
    const paint = entry.paintTime;
    if (typeof paint === "number" && Number.isFinite(paint)) {
        return paint;
    }
    return undefined;
}

function icpPaintMoment(
    entry: InteractionContentfulPaintLike | null | undefined,
): number | undefined {
    if (!entry) {
        return undefined;
    }
    const lcp = entry.largestContentfulPaint;
    if (lcp) {
        if (typeof lcp.renderTime === "number" && lcp.renderTime > 0) {
            return lcp.renderTime;
        }
        if (typeof lcp.loadTime === "number" && lcp.loadTime > 0) {
            return lcp.loadTime;
        }
        if (typeof lcp.startTime === "number" && Number.isFinite(lcp.startTime)) {
            return lcp.startTime;
        }
    }
    if (typeof entry.startTime === "number" && Number.isFinite(entry.startTime)) {
        return entry.startTime;
    }
    return undefined;
}

function clearLcpObservation(): void {
    if (lcpTimeoutId !== undefined) {
        clearTimeout(lcpTimeoutId);
        lcpTimeoutId = undefined;
    }
    if (typeof document?.removeEventListener === "function") {
        document.removeEventListener("pointerdown", onTrustedInteraction, true);
        document.removeEventListener("keydown", onTrustedInteraction, true);
        document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    if (typeof window?.removeEventListener === "function") {
        window.removeEventListener("pagehide", onPageHide);
    }
    boundLcp = undefined;
}

function disconnectObservers(): void {
    softNavObserver?.disconnect();
    softNavObserver = undefined;
    icpObserver?.disconnect();
    icpObserver = undefined;
    clearLcpObservation();
    clearAllSoftNavWaits();
    unsubscribePageView?.();
    unsubscribePageView = undefined;
    onViewFCP = undefined;
    onViewLCP = undefined;
    for (const viewId of waitingViewIds) {
        releaseViewPaintFallback("view-first-contentful-paint", viewId);
        releaseViewPaintFallback("view-largest-contentful-paint", viewId);
    }
    waitingViewIds.clear();
    setSoftNavigationPreferred(false);
}

function markUnsupported(
    reason: Extract<SoftNavigationSupportStatus, { status: "unsupported" }>["reason"],
): void {
    supportStatus = { status: "unsupported", reason };
    setSoftNavigationPreferred(false);
}

function probeEntryTypeSupport(type: string): boolean {
    const supported = (
        PerformanceObserver as unknown as {
            supportedEntryTypes?: readonly string[];
        }
    ).supportedEntryTypes;
    if (Array.isArray(supported) && supported.length > 0) {
        return supported.includes(type);
    }
    // 缺少 supportedEntryTypes 时，允许尝试 observe；失败再降级。
    return true;
}

/**
 * 当前 Soft Navigation 支持状态（最近一次探测 / 观察注册结果）。
 */
export function getSoftNavigationSupport(): SoftNavigationSupportStatus {
    return supportStatus;
}

/**
 * Soft Navigation 是否可作为 View Paint 的原生 Measurement Source。
 */
export function isSoftNavigationSupported(): boolean {
    return supportStatus.status === "supported";
}

function emitSoftViewFCP(
    pageView: ActivePageView,
    paintedAt: number,
): void {
    const value = paintedAt - pageView.startTime;
    if (!Number.isFinite(value) || value < 0) {
        return;
    }
    waitingViewIds.delete(pageView.viewId);
    clearSoftNavWait(pageView.viewId);
    tryEmitViewPaint(
        "view-first-contentful-paint",
        pageView.viewId,
        "soft-navigation",
        () => {
            const reportData: ViewFirstContentfulPaintReportData = {
                type: "performance",
                subType: "view-first-contentful-paint",
                name: "VFCP",
                value,
                pageUrl: pageView.pageUrl,
                viewId: pageView.viewId,
                measurementSource: "soft-navigation",
                startSource: pageView.startSource,
                ...(pageView.pageName !== undefined
                    ? { pageName: pageView.pageName }
                    : {}),
                ...(pageView.routePattern !== undefined
                    ? { routePattern: pageView.routePattern }
                    : {}),
            };
            dispatchReport(reportData, onViewFCP);
        },
    );
}

function finalizeSoftViewLCP(
    reason: ViewLargestContentfulPaintFinalizationReason,
): void {
    const bound = boundLcp;
    if (!bound || bound.paintedAt === undefined) {
        clearLcpObservation();
        if (bound) {
            waitingViewIds.delete(bound.viewId);
            releaseViewPaintFallback(
                "view-largest-contentful-paint",
                bound.viewId,
            );
        }
        return;
    }
    const value = bound.paintedAt - bound.startTime;
    if (!Number.isFinite(value) || value < 0) {
        clearLcpObservation();
        waitingViewIds.delete(bound.viewId);
        releaseViewPaintFallback("view-largest-contentful-paint", bound.viewId);
        return;
    }

    waitingViewIds.delete(bound.viewId);
    clearSoftNavWait(bound.viewId);
    const emitted = tryEmitViewPaint(
        "view-largest-contentful-paint",
        bound.viewId,
        "soft-navigation",
        () => {
            const reportData: ViewLargestContentfulPaintReportData = {
                type: "performance",
                subType: "view-largest-contentful-paint",
                name: "VLCP",
                value,
                pageUrl: bound.pageUrl,
                viewId: bound.viewId,
                measurementSource: "soft-navigation",
                startSource: bound.startSource,
                finalizationReason: reason,
                ...(bound.pageName !== undefined
                    ? { pageName: bound.pageName }
                    : {}),
                ...(bound.routePattern !== undefined
                    ? { routePattern: bound.routePattern }
                    : {}),
            };
            dispatchReport(reportData, onViewLCP);
        },
    );
    clearLcpObservation();
    if (!emitted) {
        releaseViewPaintFallback("view-largest-contentful-paint", bound.viewId);
    }
}

function onTrustedInteraction(event: Event): void {
    if (!event.isTrusted) {
        return;
    }
    finalizeSoftViewLCP("interaction");
}

function onVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
        finalizeSoftViewLCP("page-hidden");
    }
}

function onPageHide(): void {
    finalizeSoftViewLCP("page-hidden");
}

function bindSoftLcp(
    pageView: ActivePageView,
    entry: SoftNavigationLike,
): void {
    if (
        hasClaimedViewPaint("view-largest-contentful-paint", pageView.viewId)
    ) {
        return;
    }
    const interactionId = entry.interactionId;
    if (typeof interactionId !== "number") {
        releaseViewPaintFallback(
            "view-largest-contentful-paint",
            pageView.viewId,
        );
        return;
    }

    clearLcpObservation();
    waitingViewIds.add(pageView.viewId);
    scheduleSoftNavWait(pageView.viewId);
    const initialIcp =
        entry.getLargestInteractionContentfulPaint?.() ?? null;
    const initial = icpPaintMoment(initialIcp);
    const initialSize = initialIcp?.largestContentfulPaint?.size ?? 0;
    boundLcp = {
        viewId: pageView.viewId,
        startTime: pageView.startTime,
        startSource: pageView.startSource,
        pageUrl: pageView.pageUrl,
        interactionId,
        candidateSize: typeof initialSize === "number" ? initialSize : 0,
        ...(initial !== undefined ? { paintedAt: initial } : {}),
        ...(typeof entry.navigationId === "number"
            ? { navigationId: entry.navigationId }
            : {}),
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

    if (Number.isFinite(lcpTimeoutMs) && lcpTimeoutMs >= 0) {
        lcpTimeoutId = setTimeout(() => {
            finalizeSoftViewLCP("timeout");
        }, lcpTimeoutMs);
    }
}

function handleSoftNavigationEntries(entries: PerformanceEntry[]): void {
    const pageView = getActivePageView();
    if (!pageView) {
        return;
    }
    waitingViewIds.add(pageView.viewId);

    for (const raw of entries) {
        if (raw.entryType !== "soft-navigation") {
            continue;
        }
        const entry = raw as SoftNavigationLike;
        if (!urlsMatch(entry.name, pageView.pageUrl)) {
            continue;
        }
        if (entry.startTime + 1 < pageView.startTime) {
            // Soft-nav 明显早于 View Start：不属于当前 Page View。
            continue;
        }

        const paintedAt = paintMoment(entry);
        if (paintedAt !== undefined) {
            emitSoftViewFCP(pageView, paintedAt);
        } else {
            releaseViewPaintFallback(
                "view-first-contentful-paint",
                pageView.viewId,
            );
        }
        bindSoftLcp(pageView, entry);
    }
}

function handleIcpEntries(entries: PerformanceEntry[]): void {
    if (!boundLcp) {
        return;
    }
    for (const raw of entries) {
        if (raw.entryType !== "interaction-contentful-paint") {
            continue;
        }
        const entry = raw as InteractionContentfulPaintLike;
        if (entry.interactionId !== boundLcp.interactionId) {
            continue;
        }
        const paintedAt = icpPaintMoment(entry);
        if (paintedAt === undefined) {
            continue;
        }
        const size = entry.largestContentfulPaint?.size ?? 0;
        // 更大面积的候选替换；同等面积时保留更晚的绘制时刻。
        if (
            size > boundLcp.candidateSize ||
            (size === boundLcp.candidateSize &&
                (boundLcp.paintedAt === undefined ||
                    paintedAt >= boundLcp.paintedAt))
        ) {
            boundLcp.candidateSize = size;
            boundLcp.paintedAt = paintedAt;
        }
    }
}

function onNextPageView(pageView: ActivePageView): void {
    if (boundLcp && pageView.viewId !== boundLcp.viewId) {
        finalizeSoftViewLCP("next-page-view");
    }
    for (const viewId of [...waitingViewIds]) {
        if (viewId !== pageView.viewId) {
            waitingViewIds.delete(viewId);
            clearSoftNavWait(viewId);
            releaseViewPaintFallback("view-first-contentful-paint", viewId);
            releaseViewPaintFallback("view-largest-contentful-paint", viewId);
        }
    }
    waitingViewIds.add(pageView.viewId);
    scheduleSoftNavWait(pageView.viewId);
}

function tryCreateObserver(
    type: string,
    callback: PerformanceObserverCallback,
): PerformanceObserver | undefined {
    try {
        const observer = new PerformanceObserver(callback);
        observer.observe({ type, buffered: true });
        return observer;
    } catch {
        return undefined;
    }
}

/**
 * 在浏览器完整支持 Soft Navigation 时，将其作为 VFCP / VLCP 的优先 Measurement Source。
 *
 * - Soft-nav 条目通过 URL 与活动 Page View 关联；`value` 相对 View Start。
 * - Measurement Source（`soft-navigation`）与 Start Source（路由器 / 自动 PV）相互独立。
 * - 不支持、部分支持或 observe 失败时静默降级，不抛错。
 * - 不会由 `monitor.performance()` 自动启动。
 */
export function observeSoftNavigationViewPaint(
    options: ObserveSoftNavigationViewPaintOptions = {},
): void {
    disconnectObservers();
    onViewFCP = options.onViewFCP;
    onViewLCP = options.onViewLCP;
    lcpTimeoutMs = options.lcpTimeout ?? DEFAULT_LCP_TIMEOUT_MS;
    softNavWaitMs = options.softNavWait ?? DEFAULT_SOFT_NAV_WAIT_MS;

    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof PerformanceObserver === "undefined"
    ) {
        markUnsupported("no-observer");
        return;
    }

    const softSupported = probeEntryTypeSupport("soft-navigation");
    const icpSupported = probeEntryTypeSupport("interaction-contentful-paint");
    if (!softSupported) {
        markUnsupported("type-rejected");
        return;
    }
    if (!icpSupported) {
        markUnsupported("partial");
        return;
    }

    softNavObserver = tryCreateObserver("soft-navigation", (list) => {
        handleSoftNavigationEntries([...list.getEntries()]);
    });
    if (!softNavObserver) {
        markUnsupported("observe-failed");
        return;
    }

    icpObserver = tryCreateObserver(
        "interaction-contentful-paint",
        (list) => {
            handleIcpEntries([...list.getEntries()]);
        },
    );
    if (!icpObserver) {
        softNavObserver.disconnect();
        softNavObserver = undefined;
        markUnsupported("partial");
        return;
    }

    supportStatus = { status: "supported" };
    setSoftNavigationPreferred(true);
    unsubscribePageView = subscribeActivePageView(onNextPageView);
    const active = getActivePageView();
    if (active) {
        waitingViewIds.add(active.viewId);
        scheduleSoftNavWait(active.viewId);
    }
}

/**
 * 停止 Soft Navigation 观察并释放仍在等待的低优先级样本。
 */
export function stopObserveSoftNavigationViewPaint(): void {
    disconnectObservers();
}

/**
 * 清除 Soft Navigation 观察状态与 View Paint claim（测试与完整重启）。
 */
export function resetSoftNavigationViewPaint(): void {
    disconnectObservers();
    resetViewPaintClaims();
    supportStatus = { status: "unsupported", reason: "no-observer" };
}

export default observeSoftNavigationViewPaint;
