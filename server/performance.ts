export type PerformanceMetricName =
    | "first-paint"
    | "first-contentful-paint"
    | "largest-contentful-paint"
    | "load";

export type ViewPaintMetricName =
    | "view-first-contentful-paint"
    | "view-largest-contentful-paint"
    | "key-content-paint";

const VIEW_PAINT_METRICS: ViewPaintMetricName[] = [
    "view-first-contentful-paint",
    "view-largest-contentful-paint",
    "key-content-paint",
];

export interface PerformanceEventRow {
    id: number;
    timestamp: number;
    pageUrl: string;
    subType: string;
    data: Record<string, unknown>;
}

export interface PerformanceFilter {
    appId?: string | undefined;
    from?: number | undefined;
    to?: number | undefined;
    pageUrl?: string | undefined;
    minDuration?: number | undefined;
    maxDuration?: number | undefined;
}

export interface PerformanceMetricQuery extends PerformanceFilter {
    metrics?: PerformanceMetricName[] | undefined;
}

export interface PerformanceMetricPoint {
    metric: PerformanceMetricName;
    sampleCount: number;
    p50: number | null;
    p75: number | null;
    p95: number | null;
    trend: Array<{
        bucket: number;
        sampleCount: number;
        p50: number | null;
    }>;
    pages: Array<{
        pageUrl: string;
        sampleCount: number;
        p50: number | null;
        p75: number | null;
        p95: number | null;
    }>;
}

export type ViewPaintScope = "document" | "view";

export interface PageViewEventRow {
    id: number;
    timestamp: number;
    pageUrl: string;
    subType: string;
    data: Record<string, unknown>;
}

export interface ViewPaintMetricQuery extends PerformanceFilter {
    metrics?: ViewPaintMetricName[] | undefined;
    /** 仅 Key Content Paint：按关键内容名称过滤。 */
    keyContentName?: string | undefined;
    /**
     * 按 Measurement Source 过滤（如 `soft-navigation`）。
     * 默认不合并不同来源；筛选后仍按来源维度单独展示。
     */
    measurementSource?: string | undefined;
    /**
     * 按作用域过滤：`document` 为文档级投影，`view` 为客户端 Page View 测量。
     * 未指定时，顶层百分位与覆盖率只统计 `view`，`document` 仅出现在组成维度中。
     */
    scope?: ViewPaintScope | undefined;
    /** 按 Start Source 过滤；默认在组成维度中分列，不与其他 Start Source 混算顶层百分位以外的样本集时仍可并用过滤器。 */
    startSource?: string | undefined;
}

export interface ViewPaintMetricPoint {
    metric: ViewPaintMetricName;
    sampleCount: number;
    /** 可作为该指标分母的 Page View 数量。 */
    measurablePageViewCount: number;
    /**
     * 有效样本数 / 可测 Page View 数。
     * 分母为 0 时为 `null`；缺失测量不会变成 0 或超时样本。
     */
    metricCoverage: number | null;
    p50: number | null;
    p75: number | null;
    p95: number | null;
    pages: Array<{
        pageKey: string;
        sampleCount: number;
        p50: number | null;
        p75: number | null;
        p95: number | null;
    }>;
    sources: Array<{
        scope: ViewPaintScope;
        measurementSource: string;
        startSource: string;
        finalizationReason: string;
        sampleCount: number;
        p50: number | null;
        p75: number | null;
        p95: number | null;
    }>;
    scopes: Array<{
        scope: ViewPaintScope;
        sampleCount: number;
        p50: number | null;
        p75: number | null;
        p95: number | null;
    }>;
    keyContents: Array<{
        keyContentName: string;
        sampleCount: number;
        p50: number | null;
        p75: number | null;
        p95: number | null;
    }>;
}
export interface RequestQuery extends PerformanceFilter {
    status?: number | undefined;
    keyword?: string | undefined;
    sort?: "duration" | "status" | "url" | undefined;
    order?: "asc" | "desc" | undefined;
    page: number;
    pageSize: number;
}

export interface ResourceQuery extends PerformanceFilter {
    resourceType?: string | undefined;
    keyword?: string | undefined;
    sort?: "duration" | "url" | undefined;
    order?: "asc" | "desc" | undefined;
    page: number;
    pageSize: number;
}

export interface PerformanceListResult<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface PerformanceRequest {
    id: number;
    timestamp: number;
    pageUrl: string;
    url: string;
    method: string;
    status: number;
    duration: number;
    success: boolean;
    subType: "fetch" | "xhr";
}

export interface PerformanceResource {
    id: number;
    timestamp: number;
    pageUrl: string;
    url: string;
    resourceType: string;
    duration: number;
    transferSize: number;
    resourceSize: number;
}

function number(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentile(values: number[], rank: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * rank;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower] ?? null;
    return (sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower));
}

function statistics(values: number[]): {
    sampleCount: number;
    p50: number | null;
    p75: number | null;
    p95: number | null;
} {
    if (values.length < 2) {
        return { sampleCount: values.length, p50: null, p75: null, p95: null };
    }
    return {
        sampleCount: values.length,
        p50: percentile(values, 0.5),
        p75: percentile(values, 0.75),
        p95: percentile(values, 0.95),
    };
}

function metricValue(
    row: PerformanceEventRow,
    metric: PerformanceMetricName,
): number | null {
    if (row.subType === "first-paint" && metric === "first-paint") {
        return number(row.data.startTime);
    }
    if (row.subType === "first-contentful-paint" && metric === "first-contentful-paint") {
        return number(row.data.value);
    }
    if (row.subType === "largest-contentful-paint" && metric === "largest-contentful-paint") {
        return number(row.data.value);
    }
    if (row.subType === "load" && metric === "load") {
        return number(row.data.duration);
    }
    return null;
}

export function summarizeMetrics(
    rows: PerformanceEventRow[],
    query: PerformanceMetricQuery,
): PerformanceMetricPoint[] {
    const requested = query.metrics?.length
        ? query.metrics
        : ["first-paint", "first-contentful-paint", "largest-contentful-paint", "load"] as PerformanceMetricName[];
    const range = Math.max(1, (query.to ?? Date.now()) - (query.from ?? Math.min(...rows.map((row) => row.timestamp), Date.now())));
    const bucketSize = range <= 86_400_000
        ? 3_600_000
        : range <= 7 * 86_400_000 ? 6 * 3_600_000 : 86_400_000;

    return requested.map((metric) => {
        const samples = rows.flatMap((row) => {
            const value = metricValue(row, metric);
            return value === null || value < 0 ? [] : [{ row, value }];
        });
        const values = samples.map((sample) => sample.value);
        const grouped = new Map<number, number[]>();
        const pages = new Map<string, number[]>();
        for (const sample of samples) {
            const bucket = Math.floor(sample.row.timestamp / bucketSize) * bucketSize;
            grouped.set(bucket, [...(grouped.get(bucket) ?? []), sample.value]);
            const page = sample.row.pageUrl || "(unknown)";
            pages.set(page, [...(pages.get(page) ?? []), sample.value]);
        }
        return {
            metric,
            ...statistics(values),
            trend: [...grouped.entries()]
                .sort(([left], [right]) => left - right)
                .map(([bucket, bucketValues]) => ({
                    bucket,
                    ...statistics(bucketValues),
                })),
            pages: [...pages.entries()]
                .map(([pageUrl, pageValues]) => ({
                    pageUrl,
                    ...statistics(pageValues),
                }))
                .sort((left, right) =>
                    (right.p50 ?? -1) - (left.p50 ?? -1) ||
                    left.pageUrl.localeCompare(right.pageUrl),
                )
                .slice(0, 20),
        };
    });
}

function viewPaintPageKey(data: Record<string, unknown>): string {
    if (typeof data.pageName === "string" && data.pageName.trim()) {
        return data.pageName;
    }
    if (typeof data.routePattern === "string" && data.routePattern.trim()) {
        return data.routePattern;
    }
    return "(unknown)";
}

function viewPaintValue(
    row: PerformanceEventRow,
    metric: ViewPaintMetricName,
): number | null {
    if (row.subType === metric) {
        return number(row.data.value);
    }
    return null;
}

interface ViewPaintSample {
    value: number;
    scope: ViewPaintScope;
    pageKey: string;
    measurementSource: string;
    startSource: string;
    finalizationReason: string;
    keyContentName?: string;
    viewId?: string;
}

const DOCUMENT_PAINT_TO_VIEW: Record<string, ViewPaintMetricName> = {
    "first-contentful-paint": "view-first-contentful-paint",
    "largest-contentful-paint": "view-largest-contentful-paint",
};

function pageViewIdentity(pageView: PageViewEventRow): string {
    if (typeof pageView.data.viewId === "string" && pageView.data.viewId.trim()) {
        return pageView.data.viewId;
    }
    return `pv:${pageView.id}`;
}

function pageViewUrl(pageView: PageViewEventRow): string {
    if (typeof pageView.data.pageUrl === "string" && pageView.data.pageUrl.trim()) {
        return pageView.data.pageUrl;
    }
    return pageView.pageUrl;
}

function findInitialPageView(
    pageViews: PageViewEventRow[],
    pageUrl: string,
    timestamp: number,
): PageViewEventRow | undefined {
    const initials = pageViews.filter((pageView) => {
        if (pageView.data.startSource !== "initial") {
            return false;
        }
        return pageViewUrl(pageView) === pageUrl || pageView.pageUrl === pageUrl;
    });
    if (initials.length === 0) {
        return undefined;
    }
    return [...initials].sort(
        (left, right) =>
            Math.abs(left.timestamp - timestamp) -
            Math.abs(right.timestamp - timestamp),
    )[0];
}

/**
 * 将文档级 FCP/LCP 投影为初始 Page View 的 View Paint 样本，保留 `document` scope。
 * 不要求客户端再发一份 View Paint；找不到初始 Page View 时不投影。
 */
function projectDocumentPaintSamples(
    rows: PerformanceEventRow[],
    pageViews: PageViewEventRow[],
    metric: ViewPaintMetricName,
): ViewPaintSample[] {
    return rows.flatMap((row) => {
        const projectedMetric = DOCUMENT_PAINT_TO_VIEW[row.subType];
        if (projectedMetric !== metric) {
            return [];
        }
        const value = number(row.data.value);
        if (value === null || value < 0) {
            return [];
        }
        const pageView = findInitialPageView(pageViews, row.pageUrl, row.timestamp);
        if (!pageView) {
            return [];
        }
        return [{
            value,
            scope: "document",
            pageKey: viewPaintPageKey(pageView.data),
            measurementSource: "document",
            startSource:
                typeof pageView.data.startSource === "string"
                    ? pageView.data.startSource
                    : "initial",
            finalizationReason: "",
            viewId: pageViewIdentity(pageView),
        }];
    });
}

function collectViewPaintSamples(
    rows: PerformanceEventRow[],
    metric: ViewPaintMetricName,
): ViewPaintSample[] {
    return rows.flatMap((row) => {
        const value = viewPaintValue(row, metric);
        if (value === null || value < 0) {
            return [];
        }
        return [{
            value,
            scope: "view" as const,
            pageKey: viewPaintPageKey(row.data),
            measurementSource:
                typeof row.data.measurementSource === "string"
                    ? row.data.measurementSource
                    : "(unknown)",
            startSource:
                typeof row.data.startSource === "string"
                    ? row.data.startSource
                    : "(unknown)",
            finalizationReason:
                typeof row.data.finalizationReason === "string"
                    ? row.data.finalizationReason
                    : "",
            ...(typeof row.data.keyContentName === "string" &&
            row.data.keyContentName.trim()
                ? { keyContentName: row.data.keyContentName }
                : {}),
            ...(typeof row.data.viewId === "string" && row.data.viewId.trim()
                ? { viewId: row.data.viewId }
                : {}),
        }];
    });
}

function measurablePageViewCount(
    pageViews: PageViewEventRow[],
    scope: ViewPaintScope | undefined,
): number {
    const identities = new Set<string>();
    for (const pageView of pageViews) {
        if (scope === "document" && pageView.data.startSource !== "initial") {
            continue;
        }
        identities.add(pageViewIdentity(pageView));
    }
    return identities.size;
}

function metricCoverage(
    sampleCount: number,
    measurable: number,
): number | null {
    if (measurable <= 0) {
        return null;
    }
    return sampleCount / measurable;
}

/**
 * 按 Page Name（无则 Route Pattern）聚合 View Paint Metrics，
 * 可将文档级 FCP/LCP 投影到初始 Page View（`document` scope），
 * 默认顶层百分位与 Metric Coverage 只统计 `view` scope；
 * 组成维度保留 scope / Measurement Source / Start Source / finalization reason。
 */
export function summarizeViewPaintMetrics(
    rows: PerformanceEventRow[],
    query: ViewPaintMetricQuery,
    pageViews: PageViewEventRow[] = [],
): ViewPaintMetricPoint[] {
    const requested = query.metrics?.length
        ? query.metrics.filter((metric) => VIEW_PAINT_METRICS.includes(metric))
        : VIEW_PAINT_METRICS;
    const keyContentFilter =
        typeof query.keyContentName === "string" && query.keyContentName.trim()
            ? query.keyContentName.trim()
            : undefined;
    const measurementSourceFilter =
        typeof query.measurementSource === "string" &&
        query.measurementSource.trim()
            ? query.measurementSource.trim()
            : undefined;
    const startSourceFilter =
        typeof query.startSource === "string" && query.startSource.trim()
            ? query.startSource.trim()
            : undefined;
    const scopeFilter = query.scope;

    return requested.map((metric) => {
        const allSamples = [
            ...collectViewPaintSamples(rows, metric),
            ...projectDocumentPaintSamples(rows, pageViews, metric),
        ].filter((sample) => {
            if (metric === "key-content-paint" && keyContentFilter) {
                if (sample.keyContentName !== keyContentFilter) {
                    return false;
                }
            }
            if (
                measurementSourceFilter &&
                sample.measurementSource !== measurementSourceFilter
            ) {
                return false;
            }
            if (startSourceFilter && sample.startSource !== startSourceFilter) {
                return false;
            }
            if (scopeFilter && sample.scope !== scopeFilter) {
                return false;
            }
            return true;
        });

        // 未指定 scope 时，顶层统计只用不与 document 混算的 view 样本。
        const headlineSamples = scopeFilter
            ? allSamples
            : allSamples.filter((sample) => sample.scope === "view");
        const measurable = measurablePageViewCount(
            pageViews,
            scopeFilter === "document" ? "document" : undefined,
        );
        const pages = new Map<string, number[]>();
        const sources = new Map<string, number[]>();
        const scopes = new Map<ViewPaintScope, number[]>();
        const keyContents = new Map<string, number[]>();

        for (const sample of allSamples) {
            const sourceKey = [
                sample.scope,
                sample.measurementSource,
                sample.startSource,
                sample.finalizationReason,
            ].join("\u001f");
            sources.set(sourceKey, [
                ...(sources.get(sourceKey) ?? []),
                sample.value,
            ]);
            scopes.set(sample.scope, [
                ...(scopes.get(sample.scope) ?? []),
                sample.value,
            ]);
        }

        for (const sample of headlineSamples) {
            pages.set(sample.pageKey, [
                ...(pages.get(sample.pageKey) ?? []),
                sample.value,
            ]);
            if (metric === "key-content-paint") {
                const keyContentName = sample.keyContentName?.trim()
                    ? sample.keyContentName
                    : "(unknown)";
                keyContents.set(keyContentName, [
                    ...(keyContents.get(keyContentName) ?? []),
                    sample.value,
                ]);
            }
        }

        const headlineValues = headlineSamples.map((sample) => sample.value);
        return {
            metric,
            ...statistics(headlineValues),
            measurablePageViewCount: measurable,
            metricCoverage: metricCoverage(headlineValues.length, measurable),
            pages: [...pages.entries()]
                .map(([pageKey, pageValues]) => ({
                    pageKey,
                    ...statistics(pageValues),
                }))
                .sort(
                    (left, right) =>
                        (right.p50 ?? -1) - (left.p50 ?? -1) ||
                        right.sampleCount - left.sampleCount ||
                        left.pageKey.localeCompare(right.pageKey),
                )
                .slice(0, 20),
            sources: [...sources.entries()]
                .map(([sourceKey, sourceValues]) => {
                    const [
                        scope = "view",
                        measurementSource = "(unknown)",
                        startSource = "(unknown)",
                        finalizationReason = "",
                    ] = sourceKey.split("\u001f");
                    return {
                        scope: scope as ViewPaintScope,
                        measurementSource,
                        startSource,
                        finalizationReason,
                        ...statistics(sourceValues),
                    };
                })
                .sort(
                    (left, right) =>
                        right.sampleCount - left.sampleCount ||
                        left.scope.localeCompare(right.scope) ||
                        left.measurementSource.localeCompare(
                            right.measurementSource,
                        ) ||
                        left.startSource.localeCompare(right.startSource) ||
                        left.finalizationReason.localeCompare(
                            right.finalizationReason,
                        ),
                ),
            scopes: [...scopes.entries()]
                .map(([scope, scopeValues]) => ({
                    scope,
                    ...statistics(scopeValues),
                }))
                .sort(
                    (left, right) =>
                        right.sampleCount - left.sampleCount ||
                        left.scope.localeCompare(right.scope),
                ),
            keyContents: [...keyContents.entries()]
                .map(([keyContentName, nameValues]) => ({
                    keyContentName,
                    ...statistics(nameValues),
                }))
                .sort(
                    (left, right) =>
                        (right.p50 ?? -1) - (left.p50 ?? -1) ||
                        right.sampleCount - left.sampleCount ||
                        left.keyContentName.localeCompare(right.keyContentName),
                )
                .slice(0, 20),
        };
    });
}
