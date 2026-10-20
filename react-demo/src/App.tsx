import {
    Activity,
    AlertTriangle,
    Bug,
    CheckCircle2,
    CircleX,
    Code2,
    Database,
    Eraser,
    Gauge,
    Globe2,
    MousePointerClick,
    Network,
    Radio,
    RefreshCw,
    Route,
    Send,
    TerminalSquare,
    Zap,
} from "lucide-react";
import {
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import {
    cancelNavigationAttempt,
    commitNavigationAttempt,
    markNavigationRedirect,
    startNavigationAttempt,
    type SDKReportData,
} from "../../src/index.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import {
    clearReports,
    getReports,
    subscribeToReports,
    type ReportEntry,
} from "./reportStore.js";

interface AppProps {
    reportUrl: string;
}

type RouteName = "console" | "reports" | "coverage";
type ReportFilter = "all" | SDKReportData["type"];

const navItems: Array<{
    route: RouteName;
    label: string;
    title: string;
    icon: typeof Activity;
}> = [
    {
        route: "console",
        label: "监控台",
        title: "React 监控台",
        icon: Activity,
    },
    {
        route: "reports",
        label: "全部报告",
        title: "报告归档",
        icon: Database,
    },
    {
        route: "coverage",
        label: "采集项",
        title: "采集覆盖",
        icon: Gauge,
    },
];

const reportTypeMeta: Record<
    SDKReportData["type"],
    { label: string; className: string }
> = {
    behavior: { label: "行为", className: "type-behavior" },
    performance: { label: "性能", className: "type-performance" },
    error: { label: "错误", className: "type-error" },
    replay: { label: "回放", className: "type-replay" },
};
const reportTypes = Object.keys(
    reportTypeMeta,
) as SDKReportData["type"][];

const coverageGroups: Array<{
    title: string;
    icon: typeof Activity;
    items: string[];
    /** false = supported public API surface, not started by this demo's default boot path */
    enabled?: boolean;
}> = [
    {
        title: "页面性能",
        icon: Gauge,
        items: ["FP", "FCP", "LCP", "Load", "Resource"],
    },
    {
        title: "View Paint（需显式启用）",
        icon: Gauge,
        enabled: false,
        items: [
            "VFCP",
            "VLCP",
            "Key Content Paint",
            "Soft Navigation View Paint",
        ],
    },
    {
        title: "网络请求",
        icon: Network,
        items: ["Fetch", "XMLHttpRequest"],
    },
    {
        title: "用户行为",
        icon: MousePointerClick,
        items: [
            "PV",
            "Auto PV",
            "Navigation Attempt",
            "Click",
            "Touch",
            "Hash",
            "History",
        ],
    },
    {
        title: "异常监控",
        icon: Bug,
        items: ["JavaScript", "Promise", "Resource", "React"],
    },
];
const coverageItemCount = coverageGroups.reduce(
    (total, group) =>
        group.enabled === false ? total : total + group.items.length,
    0,
);

function routeFromHash(): RouteName {
    const route = window.location.hash.slice(2);
    if (route === "reports" || route === "coverage") {
        return route;
    }
    return "console";
}

function useRoute(): RouteName {
    const [route, setRoute] = useState<RouteName>(routeFromHash);

    useEffect(() => {
        const handleHashChange = () => setRoute(routeFromHash());
        window.addEventListener("hashchange", handleHashChange);
        return () => window.removeEventListener("hashchange", handleHashChange);
    }, []);

    return route;
}

function formatTime(timestamp: number): string {
    return new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(timestamp);
}

function getReportLocation(report: SDKReportData): string {
    if ("pageUrl" in report) {
        return report.pageUrl;
    }
    if ("to" in report) {
        return report.to;
    }
    if ("name" in report && typeof report.name === "string") {
        return report.name;
    }
    return window.location.href;
}

function ReportList({
    entries,
    limit,
}: {
    entries: ReportEntry[];
    limit?: number;
}): ReactNode {
    const visibleEntries =
        limit === undefined ? entries : entries.slice(0, limit);

    if (visibleEntries.length === 0) {
        return (
            <div className="empty-state">
                <Radio aria-hidden="true" />
                <strong>等待监控数据</strong>
                <span>新的采集结果会实时出现在这里</span>
            </div>
        );
    }

    return (
        <div className="report-list">
            {visibleEntries.map((entry) => {
                const meta = reportTypeMeta[entry.data.type];
                return (
                    <article className="report-row" key={entry.id}>
                        <header>
                            <span className={`report-kind ${meta.className}`}>
                                {meta.label}
                            </span>
                            <strong>{entry.data.subType}</strong>
                            <time>{formatTime(entry.capturedAt)}</time>
                        </header>
                        <div className="report-location">
                            {getReportLocation(entry.data)}
                        </div>
                        <pre>{JSON.stringify(entry.data, null, 2)}</pre>
                    </article>
                );
            })}
        </div>
    );
}

function CrashTrigger({ armed }: { armed: boolean }): ReactNode {
    if (armed) {
        throw new Error("demo: React render error");
    }
    return null;
}

function TestControls(): ReactNode {
    const [crashKey, setCrashKey] = useState(0);
    const [shouldCrash, setShouldCrash] = useState(false);

    function requestWithFetch(): void {
        void fetch(`/sdk-react-fetch-${Date.now()}.json`).catch(
            () => undefined,
        );
    }

    function requestWithXHR(): void {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", `/sdk-react-xhr-${Date.now()}.json`);
        xhr.send();
    }

    function throwJavaScriptError(): void {
        window.setTimeout(() => {
            throw new Error("demo: JavaScript runtime error");
        });
    }

    function rejectPromise(): void {
        void Promise.reject(
            new Error("demo: unhandled Promise rejection"),
        );
    }

    function failResource(): void {
        const image = new Image();
        image.hidden = true;
        image.addEventListener("error", () => image.remove(), {
            once: true,
        });
        document.body.append(image);
        image.src = `/sdk-react-resource-${Date.now()}.png`;
    }

    function pushHistoryRoute(route: string): void {
        const url = new URL(window.location.href);
        url.searchParams.set("route", route);
        window.history.pushState({ route }, "", url);
    }

    function commitOrdersNavigation(): void {
        const pageUrl = new URL(
            "#/scenario/orders",
            window.location.href,
        ).href;
        startNavigationAttempt();
        commitNavigationAttempt({
            pageName: "orders",
            routePattern: "/scenario/orders",
            pageUrl,
        });
        window.location.hash = "#/scenario/orders";
    }

    function cancelOrdersNavigation(): void {
        startNavigationAttempt();
        cancelNavigationAttempt();
    }

    function commitRedirectOrdersNavigation(): void {
        const pageUrl = new URL(
            "#/scenario/orders?token=secret&id=7",
            window.location.href,
        ).href;
        startNavigationAttempt();
        markNavigationRedirect();
        commitNavigationAttempt({
            pageName: "orders",
            routePattern: "/scenario/orders",
            pageUrl,
        });
        window.location.hash = "#/scenario/orders";
    }

    function resetBoundary(): void {
        setShouldCrash(false);
        setCrashKey((current) => current + 1);
    }

    return (
        <section className="test-section" aria-labelledby="test-title">
            <div className="section-heading">
                <div>
                    <span className="section-label">EVENT LAB</span>
                    <h2 id="test-title">事件触发器</h2>
                </div>
                <span className="section-note">
                    本示例演示页面访问与 Navigation Attempt 公共 API，不采集点击。自动 PV 带 startSource；手动 commit 可附带 pageName / routePattern，取消则不上报。
                </span>
            </div>
            <div className="action-grid">
                <button type="button" onClick={requestWithFetch}>
                    <Globe2 aria-hidden="true" />
                    <span>Fetch 请求</span>
                </button>
                <button type="button" onClick={requestWithXHR}>
                    <Network aria-hidden="true" />
                    <span>XHR 请求</span>
                </button>
                <button
                    type="button"
                    onClick={() => pushHistoryRoute("orders")}
                >
                    <Route aria-hidden="true" />
                    <span>History 订单</span>
                </button>
                <button
                    type="button"
                    onClick={() => pushHistoryRoute("profile")}
                >
                    <Route aria-hidden="true" />
                    <span>History 个人</span>
                </button>
                <button type="button" onClick={commitOrdersNavigation}>
                    <Route aria-hidden="true" />
                    <span>提交导航 Attempt</span>
                </button>
                <button type="button" onClick={cancelOrdersNavigation}>
                    <Route aria-hidden="true" />
                    <span>取消导航 Attempt</span>
                </button>
                <button type="button" onClick={commitRedirectOrdersNavigation}>
                    <Route aria-hidden="true" />
                    <span>重定向后提交</span>
                </button>
                <button type="button" onClick={throwJavaScriptError}>
                    <TerminalSquare aria-hidden="true" />
                    <span>JS 异常</span>
                </button>
                <button type="button" onClick={rejectPromise}>
                    <Zap aria-hidden="true" />
                    <span>Promise 异常</span>
                </button>
                <button type="button" onClick={failResource}>
                    <CircleX aria-hidden="true" />
                    <span>资源异常</span>
                </button>
                <button
                    type="button"
                    onClick={() => setShouldCrash(true)}
                >
                    <Code2 aria-hidden="true" />
                    <span>React 异常</span>
                </button>
            </div>
            <ErrorBoundary key={crashKey} onReset={resetBoundary}>
                <CrashTrigger armed={shouldCrash} />
            </ErrorBoundary>
        </section>
    );
}

function FilterBar({
    active,
    entries,
    onChange,
}: {
    active: ReportFilter;
    entries: ReportEntry[];
    onChange: (filter: ReportFilter) => void;
}): ReactNode {
    const counts = useMemo(() => {
        const result = Object.fromEntries(
            reportTypes.map((type) => [type, 0]),
        ) as Record<SDKReportData["type"], number>;
        for (const entry of entries) {
            result[entry.data.type] += 1;
        }
        return result;
    }, [entries]);

    return (
        <div className="filter-bar" aria-label="报告类型筛选">
            <button
                className={active === "all" ? "active" : ""}
                type="button"
                onClick={() => onChange("all")}
            >
                全部 <span>{entries.length}</span>
            </button>
            {reportTypes.map((type) => (
                <button
                    className={active === type ? "active" : ""}
                    key={type}
                    type="button"
                    onClick={() => onChange(type)}
                >
                    {reportTypeMeta[type].label}
                    <span>{counts[type]}</span>
                </button>
            ))}
        </div>
    );
}

function ReportsPanel({
    entries,
    compact = false,
}: {
    entries: ReportEntry[];
    compact?: boolean;
}): ReactNode {
    const [filter, setFilter] = useState<ReportFilter>("all");
    const filteredEntries =
        filter === "all"
            ? entries
            : entries.filter((entry) => entry.data.type === filter);

    return (
        <section className="reports-section" aria-labelledby="reports-title">
            <div className="section-heading reports-heading">
                <div>
                    <span className="section-label">LIVE STREAM</span>
                    <h2 id="reports-title">
                        {compact ? "最近报告" : "全部报告"}
                    </h2>
                </div>
                <button
                    className="icon-command"
                    type="button"
                    aria-label="清空报告"
                    title="清空报告"
                    disabled={entries.length === 0}
                    onClick={clearReports}
                >
                    <Eraser aria-hidden="true" />
                </button>
            </div>
            <FilterBar
                active={filter}
                entries={entries}
                onChange={setFilter}
            />
            <ReportList
                entries={filteredEntries}
                {...(compact ? { limit: 6 } : {})}
            />
        </section>
    );
}

function ConsoleView({
    entries,
    reportUrl,
}: {
    entries: ReportEntry[];
    reportUrl: string;
}): ReactNode {
    const categories = new Set(entries.map((entry) => entry.data.type));

    return (
        <>
            <section className="metrics-grid" aria-label="运行状态">
                <article>
                    <div className="metric-icon metric-green">
                        <Activity aria-hidden="true" />
                    </div>
                    <div>
                        <span>已采集</span>
                        <strong>{entries.length}</strong>
                        <small>最近 100 条报告</small>
                    </div>
                </article>
                <article>
                    <div className="metric-icon metric-amber">
                        <Gauge aria-hidden="true" />
                    </div>
                    <div>
                        <span>活跃分类</span>
                        <strong>
                            {categories.size} / {reportTypes.length}
                        </strong>
                        <small>
                            {reportTypes
                                .map((type) => reportTypeMeta[type].label)
                                .join(" · ")}
                        </small>
                    </div>
                </article>
                <article className="endpoint-metric">
                    <div className="metric-icon metric-blue">
                        <Send aria-hidden="true" />
                    </div>
                    <div>
                        <span>上报端点</span>
                        <strong>自动上报</strong>
                        <small title={reportUrl}>{reportUrl}</small>
                    </div>
                </article>
            </section>
            <TestControls />
            <ReportsPanel compact entries={entries} />
        </>
    );
}

function CoverageView(): ReactNode {
    return (
        <section className="coverage-section">
            <div className="section-heading">
                <div>
                    <span className="section-label">COLLECTION COVERAGE</span>
                    <h2>采集项</h2>
                </div>
                <span className="coverage-total">
                    <CheckCircle2 aria-hidden="true" />
                    {coverageItemCount} 项已启用
                </span>
            </div>
            <div className="coverage-grid">
                {coverageGroups.map((group) => {
                    const Icon = group.icon;
                    return (
                        <article key={group.title}>
                            <header>
                                <Icon aria-hidden="true" />
                                <strong>{group.title}</strong>
                            </header>
                            <ul>
                                {group.items.map((item) => (
                                    <li key={item}>
                                        {group.enabled === false ? null : (
                                            <CheckCircle2 aria-hidden="true" />
                                        )}
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

export function App({ reportUrl }: AppProps): ReactNode {
    const entries = useSyncExternalStore(
        subscribeToReports,
        getReports,
        getReports,
    );
    const route = useRoute();
    const activeRoute =
        navItems.find((item) => item.route === route) ?? navItems[0]!;

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <a className="brand" href="#/console">
                    <span className="brand-mark">
                        <Radio aria-hidden="true" />
                    </span>
                    <span>
                        <strong>Signal Desk</strong>
                        <small>React monitor</small>
                    </span>
                </a>
                <nav aria-label="主导航">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        return (
                            <a
                                className={
                                    route === item.route ? "active" : ""
                                }
                                href={`#/${item.route}`}
                                key={item.route}
                            >
                                <Icon aria-hidden="true" />
                                {item.label}
                            </a>
                        );
                    })}
                </nav>
                <div className="sidebar-status">
                    <span className="pulse-dot" />
                    <div>
                        <strong>SDK 运行中</strong>
                        <small>实时采集与上报</small>
                    </div>
                </div>
            </aside>
            <div className="main-column">
                <header className="topbar">
                    <div>
                        <span className="page-kicker">FRONTEND MONITOR SDK</span>
                        <h1>{activeRoute.title}</h1>
                    </div>
                    <div className="connection-state">
                        <span />
                        上报端点已配置
                    </div>
                </header>
                <main>
                    {route === "console" && (
                        <ConsoleView
                            entries={entries}
                            reportUrl={reportUrl}
                        />
                    )}
                    {route === "reports" && (
                        <ReportsPanel entries={entries} />
                    )}
                    {route === "coverage" && <CoverageView />}
                </main>
                <footer>
                    <span>frontend-moniter-sdk · react-demo</span>
                    <a href="#/console">
                        <RefreshCw aria-hidden="true" />
                        返回实时监控
                    </a>
                </footer>
            </div>
        </div>
    );
}
