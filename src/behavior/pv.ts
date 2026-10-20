import { dispatchReport } from "../report.js";
import { generateBehaviorId } from "./utils.js";

/**
 * 建立 View Start 的机制。
 *
 * - `initial`：文档初次呈现（聚合入口启动时的当前页）
 * - `manual`：业务直接调用 `observePV()`
 * - `navigation`：框架/手动 Navigation Attempt 提交
 * - `history` / `hashchange` / `popstate`：自动 URL 观察回退
 */
export type PageViewStartSource =
    | "initial"
    | "manual"
    | "navigation"
    | "history"
    | "hashchange"
    | "popstate";

/**
 * 页面访问（PV）上报数据。
 */
export interface PageViewReportData {
    /** 监控数据的一级分类。 */
    type: "behavior";
    /** 监控数据的二级分类。 */
    subType: "pv";
    /** View Start：相对于当前页面时间原点的毫秒数。 */
    startTime: number;
    /** 脱敏后的页面地址，用于单次诊断而非默认聚合。 */
    pageUrl: string;
    /** 进入当前页面前的来源地址。 */
    referrer: string;
    /** 本条行为数据的唯一标识。 */
    uuid: string;
    /** 本 Page View 的稳定身份，供后续 View Paint Metrics 关联。 */
    viewId: string;
    /** 建立 View Start 的机制。 */
    startSource: PageViewStartSource;
    /** 应用定义的业务页面名；优先作为聚合键。 */
    pageName?: string;
    /** 参数化路由模板；在缺少 Page Name 时作为聚合回退。 */
    routePattern?: string;
    /** 到达最终展示页面前发生的重定向次数。 */
    redirectCount?: number;
}

export type PageViewReportHandler = (
    reportData: PageViewReportData,
) => void;

/**
 * 手动或框架提交一次 Page View 时可附带的字段。
 */
export interface PageViewOptions {
    /** 覆盖 View Start；默认 `performance.now()`。 */
    startTime?: number;
    /** 覆盖采集地址；默认使用当前 `location.href`（仍会脱敏）。 */
    pageUrl?: string;
    /** 应用定义的业务页面名。 */
    pageName?: string;
    /** 参数化路由模板。 */
    routePattern?: string;
    /** 建立 View Start 的机制；默认 `manual`。 */
    startSource?: PageViewStartSource;
    /** 稳定 Page View 身份；默认生成新 ID。 */
    viewId?: string;
    /** 到达最终展示页面前的重定向次数。 */
    redirectCount?: number;
}

const SENSITIVE_QUERY_KEYS = new Set([
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "password",
    "passwd",
    "secret",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "session",
    "sessionid",
    "sid",
    "code",
]);

let lastReportedPageUrl: string | undefined;

/**
 * 清除最近一次成功上报的页面地址。
 *
 * 停止行为监控时调用，让下一次启动可以重新记录当前页。
 */
export function clearPageViewDedup(): void {
    lastReportedPageUrl = undefined;
}

/**
 * 移除 URL 中已知敏感的 query 参数，保留 pathname 与 hash。
 *
 * 无法解析的字符串原样返回。
 */
export function sanitizePageUrl(href: string): string {
    try {
        const url = new URL(href);
        const keys = [...url.searchParams.keys()];
        for (const key of keys) {
            if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
                url.searchParams.delete(key);
            }
        }
        return url.toString();
    } catch {
        return href;
    }
}

/**
 * 立即记录一次当前页面访问。
 *
 * 连续采集到相同脱敏 `pageUrl` 时跳过，避免自动监听和路由钩子把同一地址记两次。
 * 地址变化后再次调用会重新上报。
 */
export function observePV(
    onReport?: PageViewReportHandler,
    options: PageViewOptions = {},
): void {
    if (
        typeof window === "undefined" ||
        typeof document === "undefined" ||
        typeof performance === "undefined"
    ) {
        return;
    }

    const rawPageUrl = options.pageUrl ?? window.location.href;
    const pageUrl = sanitizePageUrl(rawPageUrl);
    if (pageUrl === lastReportedPageUrl) {
        return;
    }

    const viewId = options.viewId ?? generateBehaviorId();
    lastReportedPageUrl = pageUrl;
    dispatchReport(
        {
            type: "behavior",
            subType: "pv",
            startTime: options.startTime ?? performance.now(),
            pageUrl,
            referrer: document.referrer,
            uuid: viewId,
            viewId,
            startSource: options.startSource ?? "manual",
            ...(options.pageName !== undefined
                ? { pageName: options.pageName }
                : {}),
            ...(options.routePattern !== undefined
                ? { routePattern: options.routePattern }
                : {}),
            ...(options.redirectCount !== undefined
                ? { redirectCount: options.redirectCount }
                : {}),
        },
        onReport,
    );
}

export default observePV;
