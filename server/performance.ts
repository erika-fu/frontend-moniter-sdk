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

export interface ViewPaintMetricQuery extends PerformanceFilter {
    metrics?: ViewPaintMetricName[] | undefined;
    /** 仅 Key Content Paint：按关键内容名称过滤。 */
    keyContentName?: string | undefined;
    /**
     * 按 Measurement Source 过滤（如 `soft-navigation`）。
     * 默认不合并不同来源；筛选后仍按来源维度单独展示。
     */
    measurementSource?: string | undefined;
}

export interface ViewPaintMetricPoint {
    metric: ViewPaintMetricName;
    sampleCount: number;
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
        measurementSource: string;
        startSource: string;
        finalizationReason: string;
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

/**
 * 按 Page Name（无则 Route Pattern）聚合 View Paint Metrics，
 * 并保留 Measurement Source、Start Source 与 finalization reason；
 * Key Content Paint 另可按关键内容名称过滤与分组；
 * 不与文档级 FCP / LCP 混用，各 View Paint Metric 彼此独立。
 */
export function summarizeViewPaintMetrics(
    rows: PerformanceEventRow[],
    query: ViewPaintMetricQuery,
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

    return requested.map((metric) => {
        const samples = rows.flatMap((row) => {
            const value = viewPaintValue(row, metric);
            if (value === null || value < 0) {
                return [];
            }
            if (metric === "key-content-paint" && keyContentFilter) {
                const name =
                    typeof row.data.keyContentName === "string"
                        ? row.data.keyContentName
                        : "";
                if (name !== keyContentFilter) {
                    return [];
                }
            }
            if (measurementSourceFilter) {
                const source =
                    typeof row.data.measurementSource === "string"
                        ? row.data.measurementSource
                        : "";
                if (source !== measurementSourceFilter) {
                    return [];
                }
            }
            return [{ row, value }];
        });
        const values = samples.map((sample) => sample.value);
        const pages = new Map<string, number[]>();
        const sources = new Map<string, number[]>();
        const keyContents = new Map<string, number[]>();
        for (const sample of samples) {
            const pageKey = viewPaintPageKey(sample.row.data);
            pages.set(pageKey, [...(pages.get(pageKey) ?? []), sample.value]);
            const measurementSource =
                typeof sample.row.data.measurementSource === "string"
                    ? sample.row.data.measurementSource
                    : "(unknown)";
            const startSource =
                typeof sample.row.data.startSource === "string"
                    ? sample.row.data.startSource
                    : "(unknown)";
            const finalizationReason =
                typeof sample.row.data.finalizationReason === "string"
                    ? sample.row.data.finalizationReason
                    : "";
            const sourceKey = `${measurementSource}\u001f${startSource}\u001f${finalizationReason}`;
            sources.set(sourceKey, [
                ...(sources.get(sourceKey) ?? []),
                sample.value,
            ]);
            if (metric === "key-content-paint") {
                const keyContentName =
                    typeof sample.row.data.keyContentName === "string" &&
                    sample.row.data.keyContentName.trim()
                        ? sample.row.data.keyContentName
                        : "(unknown)";
                keyContents.set(keyContentName, [
                    ...(keyContents.get(keyContentName) ?? []),
                    sample.value,
                ]);
            }
        }
        return {
            metric,
            ...statistics(values),
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
                        measurementSource = "(unknown)",
                        startSource = "(unknown)",
                        finalizationReason = "",
                    ] = sourceKey.split("\u001f");
                    return {
                        measurementSource,
                        startSource,
                        finalizationReason,
                        ...statistics(sourceValues),
                    };
                })
                .sort(
                    (left, right) =>
                        right.sampleCount - left.sampleCount ||
                        left.measurementSource.localeCompare(
                            right.measurementSource,
                        ) ||
                        left.startSource.localeCompare(right.startSource) ||
                        left.finalizationReason.localeCompare(
                            right.finalizationReason,
                        ),
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
