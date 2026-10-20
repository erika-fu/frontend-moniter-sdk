/**
 * View Paint 正式样本去重与来源优先级。
 *
 * 优先级：soft-navigation > container-observer > application-mark。
 * 容器观察在报告里仍使用 `declared-content` / `declared-region` 字面量。
 */

export type ViewPaintMetricKind =
    | "view-first-contentful-paint"
    | "view-largest-contentful-paint";

export type ViewPaintSourcePriority =
    | "soft-navigation"
    | "container-observer"
    | "application-mark";

const PRIORITY_RANK: Record<ViewPaintSourcePriority, number> = {
    "soft-navigation": 3,
    "container-observer": 2,
    "application-mark": 1,
};

const claimed = {
    "view-first-contentful-paint": new Set<string>(),
    "view-largest-contentful-paint": new Set<string>(),
} as const;

interface DeferredEmit {
    priority: ViewPaintSourcePriority;
    emit: () => void;
}

const deferred = {
    "view-first-contentful-paint": new Map<string, DeferredEmit>(),
    "view-largest-contentful-paint": new Map<string, DeferredEmit>(),
} as const;

let softNavigationPreferred = false;

/**
 * 将报告里的 Measurement Source 映射到优先级档位。
 */
export function toViewPaintSourcePriority(
    measurementSource: string,
): ViewPaintSourcePriority {
    if (measurementSource === "soft-navigation") {
        return "soft-navigation";
    }
    if (measurementSource === "application-mark") {
        return "application-mark";
    }
    return "container-observer";
}

export function setSoftNavigationPreferred(preferred: boolean): void {
    softNavigationPreferred = preferred;
}

export function hasClaimedViewPaint(
    metric: ViewPaintMetricKind,
    viewId: string,
): boolean {
    return claimed[metric].has(viewId);
}

/**
 * 尝试以给定优先级产出正式样本。
 *
 * - 已上报：拒绝
 * - soft-navigation 优先且当前为低优先级：暂存（更高档覆盖更低档）
 * - 否则立即 claim 并执行 emit
 */
export function tryEmitViewPaint(
    metric: ViewPaintMetricKind,
    viewId: string,
    priority: ViewPaintSourcePriority,
    emit: () => void,
): boolean {
    if (claimed[metric].has(viewId)) {
        return false;
    }

    if (softNavigationPreferred && priority !== "soft-navigation") {
        const existing = deferred[metric].get(viewId);
        if (
            !existing ||
            PRIORITY_RANK[priority] >= PRIORITY_RANK[existing.priority]
        ) {
            deferred[metric].set(viewId, { priority, emit });
        }
        return false;
    }

    claimed[metric].add(viewId);
    deferred[metric].delete(viewId);
    emit();
    return true;
}

/**
 * soft-navigation 放弃该 Page View 时，释放暂存的低优先级样本。
 */
export function releaseViewPaintFallback(
    metric: ViewPaintMetricKind,
    viewId: string,
): void {
    if (claimed[metric].has(viewId)) {
        deferred[metric].delete(viewId);
        return;
    }
    const pending = deferred[metric].get(viewId);
    if (!pending) {
        return;
    }
    deferred[metric].delete(viewId);
    claimed[metric].add(viewId);
    pending.emit();
}

export function resetViewPaintClaims(
    metric?: ViewPaintMetricKind,
): void {
    if (metric) {
        claimed[metric].clear();
        deferred[metric].clear();
        return;
    }
    claimed["view-first-contentful-paint"].clear();
    claimed["view-largest-contentful-paint"].clear();
    deferred["view-first-contentful-paint"].clear();
    deferred["view-largest-contentful-paint"].clear();
    softNavigationPreferred = false;
}
