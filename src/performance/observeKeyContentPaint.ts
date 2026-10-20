import {
    getActivePageView,
    type PageViewStartSource,
} from "../behavior/pv.js";
import { dispatchReport } from "../report.js";

/**
 * 判定 Key Content Paint 绘制时刻的机制。
 */
export type KeyContentPaintMeasurementSource =
    | "application-mark"
    | "declared-content";

/**
 * Key Content Paint 上报数据。
 *
 * 与 View Largest Contentful Paint 相互独立；`value` 为相对 View Start 的毫秒数。
 * 同一 Page View 上按 `keyContentName` 去重，不同名称可并存。
 */
export interface KeyContentPaintReportData {
    type: "performance";
    subType: "key-content-paint";
    name: "KCP";
    value: number;
    pageUrl: string;
    viewId: string;
    keyContentName: string;
    measurementSource: KeyContentPaintMeasurementSource;
    startSource: PageViewStartSource;
    pageName?: string;
    routePattern?: string;
}

export type KeyContentPaintReportHandler = (
    reportData: KeyContentPaintReportData,
) => void;

export interface ObserveKeyContentPaintOptions {
    /** 应用声明的关键内容名称，例如 `product-price`。 */
    name: string;
    /** 观察根节点；省略时使用 `document.body`。 */
    root?: Element | string;
    onReport?: KeyContentPaintReportHandler;
}

const reportedKeys = new Set<string>();

interface DeclaredObservation {
    name: string;
    root: Element;
    onReport: KeyContentPaintReportHandler | undefined;
    observer: MutationObserver;
}

const declaredObservations = new Map<string, DeclaredObservation>();

function reportKey(viewId: string, keyContentName: string): string {
    return `${viewId}\u001f${keyContentName}`;
}

function normalizeName(name: string): string | undefined {
    const trimmed = name.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function disconnectDeclared(name?: string): void {
    if (name !== undefined) {
        const observation = declaredObservations.get(name);
        observation?.observer.disconnect();
        declaredObservations.delete(name);
        return;
    }
    for (const observation of declaredObservations.values()) {
        observation.observer.disconnect();
    }
    declaredObservations.clear();
}

/**
 * 停止声明内容观察。已上报的 `(viewId, keyContentName)` 集合保留。
 */
export function stopObserveKeyContentPaint(name?: string): void {
    disconnectDeclared(name !== undefined ? normalizeName(name) : undefined);
}

/**
 * 清除已上报集合并停止观察（测试与完整重启）。
 */
export function resetKeyContentPaint(): void {
    reportedKeys.clear();
    disconnectDeclared();
}

function emitKeyContentPaint(
    keyContentName: string,
    measurementSource: KeyContentPaintMeasurementSource,
    onReport?: KeyContentPaintReportHandler,
): boolean {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined"
    ) {
        return false;
    }

    const normalized = normalizeName(keyContentName);
    if (!normalized) {
        return false;
    }

    const pageView = getActivePageView();
    if (!pageView) {
        return false;
    }

    const key = reportKey(pageView.viewId, normalized);
    if (reportedKeys.has(key)) {
        return false;
    }

    const value = performance.now() - pageView.startTime;
    if (!Number.isFinite(value) || value < 0) {
        return false;
    }

    reportedKeys.add(key);
    const reportData: KeyContentPaintReportData = {
        type: "performance",
        subType: "key-content-paint",
        name: "KCP",
        value,
        pageUrl: pageView.pageUrl,
        viewId: pageView.viewId,
        keyContentName: normalized,
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
 * 业务显式标记：当前 Page View 上名为 `name` 的关键内容已可见。
 *
 * Measurement Source 为 `application-mark`。同一 `(viewId, name)` 最多上报一次。
 */
export function markKeyContentPaint(
    name: string,
    onReport?: KeyContentPaintReportHandler,
): void {
    emitKeyContentPaint(name, "application-mark", onReport);
}

function isExcludedContent(element: Element): boolean {
    return (
        element.hasAttribute("data-view-skeleton") ||
        element.hasAttribute("data-view-placeholder") ||
        element.hasAttribute("data-view-spinner")
    );
}

function isMatchingKeyContent(node: Node, name: string): node is Element {
    if (!(node instanceof Element)) {
        return false;
    }
    const pageView = getActivePageView();
    if (!pageView || pageView.retainedNodes.has(node) || isExcludedContent(node)) {
        return false;
    }
    if (node.getAttribute("data-key-content") !== name) {
        return false;
    }
    const text = node.textContent?.trim() ?? "";
    if (text.length === 0 && !node.querySelector("img,svg,canvas,video")) {
        return false;
    }
    return true;
}

function scanDeclaredContent(observation: DeclaredObservation): void {
    const candidates = [
        observation.root,
        ...observation.root.querySelectorAll("[data-key-content]"),
    ];
    for (const candidate of candidates) {
        if (isMatchingKeyContent(candidate, observation.name)) {
            if (
                emitKeyContentPaint(
                    observation.name,
                    "declared-content",
                    observation.onReport,
                )
            ) {
                disconnectDeclared(observation.name);
            }
            return;
        }
    }
}

/**
 * 观察声明内容区：带 `data-key-content="<name>"` 且非 skeleton / placeholder /
 * spinner / 空节点 / View Start 前已存在节点的元素出现时上报。
 *
 * Measurement Source 为 `declared-content`。同一 `(viewId, name)` 最多上报一次。
 * 时刻取自 DOM 变更后的 `performance.now()`，近似而非浏览器 paint 时间戳。
 */
export function observeKeyContentPaint(
    options: ObserveKeyContentPaintOptions,
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof MutationObserver === "undefined"
    ) {
        return;
    }

    const name = normalizeName(options.name);
    if (!name) {
        return;
    }

    disconnectDeclared(name);

    const root =
        typeof options.root === "string"
            ? document.querySelector(options.root)
            : options.root ?? document.body;
    if (!root) {
        return;
    }

    const pageView = getActivePageView();
    if (!pageView || reportedKeys.has(reportKey(pageView.viewId, name))) {
        return;
    }

    const observation: DeclaredObservation = {
        name,
        root,
        onReport: options.onReport,
        observer: new MutationObserver(() => {
            const current = declaredObservations.get(name);
            if (current) {
                scanDeclaredContent(current);
            }
        }),
    };
    declaredObservations.set(name, observation);

    scanDeclaredContent(observation);
    if (
        declaredObservations.has(name) &&
        !reportedKeys.has(reportKey(pageView.viewId, name))
    ) {
        observation.observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        });
    }
}

export default observeKeyContentPaint;
