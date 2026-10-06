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
