import {
    observePV,
    type PageViewOptions,
    type PageViewReportHandler,
} from "./pv.js";
import { generateBehaviorId } from "./utils.js";

/**
 * 开始一次 Navigation Attempt 时可附带的选项。
 */
export interface StartNavigationAttemptOptions {
    /** 接收本次 Attempt 最终提交的 Page View。 */
    onReport?: PageViewReportHandler;
    /** 覆盖 View Start；默认 `performance.now()`。 */
    startTime?: number;
    /** 预分配的 Page View 身份；默认生成新 ID。 */
    viewId?: string;
}

/**
 * 提交 Navigation Attempt 时可附带的目的地信息。
 */
export interface CommitNavigationAttemptOptions {
    /** 应用定义的业务页面名。 */
    pageName?: string;
    /** 参数化路由模板。 */
    routePattern?: string;
    /** 覆盖最终地址；默认使用当前 `location.href`。 */
    pageUrl?: string;
    /** 覆盖重定向次数；默认使用 Attempt 内累计值。 */
    redirectCount?: number;
}

interface ActiveNavigationAttempt {
    startTime: number;
    viewId: string;
    redirectCount: number;
    onReport?: PageViewReportHandler;
}

let activeAttempt: ActiveNavigationAttempt | undefined;

/**
 * 标记一次 Navigation Attempt 开始。
 *
 * 此时尚不产生 Page View。取消的目的地不会上报；重定向链保留原始
 * View Start，并在最终提交时带上累计 `redirectCount`。
 */
export function startNavigationAttempt(
    options: StartNavigationAttemptOptions = {},
): string {
    if (activeAttempt) {
        if (options.onReport) {
            activeAttempt.onReport = options.onReport;
        }
        return activeAttempt.viewId;
    }

    const startTime =
        options.startTime ??
        (typeof performance !== "undefined" ? performance.now() : 0);
    const viewId = options.viewId ?? generateBehaviorId();

    activeAttempt = {
        startTime,
        viewId,
        redirectCount: 0,
        ...(options.onReport ? { onReport: options.onReport } : {}),
    };

    return viewId;
}

/**
 * 记录一次仍处于同一 Navigation Attempt 内的重定向。
 *
 * 不会产生 Page View；仅增加后续提交时的 `redirectCount`。
 */
export function markNavigationRedirect(): void {
    if (!activeAttempt) {
        return;
    }
    activeAttempt.redirectCount += 1;
}

/**
 * 取消当前 Navigation Attempt，不产生 Page View。
 */
export function cancelNavigationAttempt(): void {
    activeAttempt = undefined;
}

/**
 * 将当前 Navigation Attempt 提交为一次 Page View。
 *
 * 使用 Attempt 开始时的 View Start 与 viewId；未展示的中间目的地不会单独上报。
 */
export function commitNavigationAttempt(
    options: CommitNavigationAttemptOptions = {},
): void {
    if (!activeAttempt) {
        return;
    }

    const attempt = activeAttempt;
    activeAttempt = undefined;

    const redirectCount =
        options.redirectCount !== undefined
            ? options.redirectCount
            : attempt.redirectCount;

    const pageViewOptions: PageViewOptions = {
        startTime: attempt.startTime,
        viewId: attempt.viewId,
        startSource: "navigation",
        ...(redirectCount > 0 ? { redirectCount } : {}),
        ...(options.pageName !== undefined
            ? { pageName: options.pageName }
            : {}),
        ...(options.routePattern !== undefined
            ? { routePattern: options.routePattern }
            : {}),
        ...(options.pageUrl !== undefined ? { pageUrl: options.pageUrl } : {}),
    };

    observePV(attempt.onReport, pageViewOptions);
}

/**
 * 清除进行中的 Navigation Attempt（停止行为监控时调用）。
 */
export function clearNavigationAttempt(): void {
    activeAttempt = undefined;
}

export default startNavigationAttempt;
