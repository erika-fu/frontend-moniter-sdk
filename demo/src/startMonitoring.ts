export interface DemoMonitorEnv {
    url?: string | undefined;
    projectName?: string | undefined;
    appId?: string | undefined;
    userId?: string | undefined;
    release?: string | undefined;
}

interface DemoMonitor {
    init(options: {
        url: string;
        projectName: string;
        appId: string;
        userId: string;
        release: string;
        batchSize: number;
    }): void;
    performance(): void;
    behavior(options: { clickAttributes: string[] }): void;
    error(): void;
}

/**
 * 启动 Vue demo 的监控采集。
 *
 * 行为点击只允许 `clstag`，页面访问、性能和异常采集保持开启。
 */
export function startDemoMonitoring(
    sdk: DemoMonitor,
    env: DemoMonitorEnv = {},
): void {
    sdk.init({
        url: env.url ?? "http://localhost:9800/api/v1/reportData",
        projectName: env.projectName ?? "frontend-moniter-sdk-demo",
        appId: env.appId ?? "vue-demo",
        userId: env.userId ?? "local-developer",
        release: env.release ?? "demo@0.1.0",
        batchSize: 1,
    });
    sdk.performance();
    sdk.behavior({
        clickAttributes: ["clstag"],
    });
    sdk.error();
}
