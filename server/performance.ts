export type PerformanceMetricName =
    | "first-paint"
    | "first-contentful-paint"
    | "largest-contentful-paint"
    | "load";

export type ViewPaintMetricName = "view-first-contentful-paint";

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
    if (
        metric === "view-first-contentful-paint" &&
        row.subType === "view-first-contentful-paint"
    ) {
        return number(row.data.value);
    }
    return null;
}

/**
 * 按 Page Name（无则 Route Pattern）聚合 View Paint Metrics，
 * 并保留 Measurement Source / Start Source 维度；不与文档级 FCP 混用。
 */
export function summarizeViewPaintMetrics(
    rows: PerformanceEventRow[],
    query: ViewPaintMetricQuery,
): ViewPaintMetricPoint[] {
    const requested = query.metrics?.length
        ? query.metrics
        : (["view-first-contentful-paint"] as ViewPaintMetricName[]);

    return requested.map((metric) => {
        const samples = rows.flatMap((row) => {
            const value = viewPaintValue(row, metric);
            return value === null || value < 0 ? [] : [{ row, value }];
        });
        const values = samples.map((sample) => sample.value);
        const pages = new Map<string, number[]>();
        const sources = new Map<string, number[]>();
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
            const sourceKey = `${measurementSource}\u001f${startSource}`;
            sources.set(sourceKey, [
                ...(sources.get(sourceKey) ?? []),
                sample.value,
            ]);
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
                    const [measurementSource = "(unknown)", startSource = "(unknown)"] =
                        sourceKey.split("\u001f");
                    return {
                        measurementSource,
                        startSource,
                        ...statistics(sourceValues),
                    };
                })
                .sort(
                    (left, right) =>
                        right.sampleCount - left.sampleCount ||
                        left.measurementSource.localeCompare(
                            right.measurementSource,
                        ) ||
                        left.startSource.localeCompare(right.startSource),
                ),
        };
    });
}
