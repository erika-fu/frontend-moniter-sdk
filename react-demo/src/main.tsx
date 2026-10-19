import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import frontendMonitor from "../../src/index.js";
import { App } from "./App.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { addReport } from "./reportStore.js";
import "./style.css";

const reportUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/api/v1/reportData";

frontendMonitor.init({
    url: reportUrl,
    projectName: "frontend-moniter-sdk-react-demo",
    appId: "react-demo",
    userId: "local-developer",
    batchSize: 1,
});

frontendMonitor.subscribe(addReport);
frontendMonitor.performance();
// 不传 clickAttributes：本示例只演示页面访问和导航，不采集点击。
// 默认开启 autoPageView：侧边栏 Hash 导航和 History 切换都会自动记 PV。
frontendMonitor.behavior();
frontendMonitor.error();

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
    throw new Error("React root element was not found");
}

createRoot(root).render(
    <StrictMode>
        <ErrorBoundary onReset={() => window.location.reload()}>
            <App reportUrl={reportUrl} />
        </ErrorBoundary>
    </StrictMode>,
);
