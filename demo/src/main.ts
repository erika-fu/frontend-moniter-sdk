import { createApp } from "vue";
import frontendMonitor from "../../src/index.js";
import { addReport, replaceReportsFromServer } from "./reportStore.js";
import { router } from "./router/index.js";
import App from "./App.vue";
import "./style.css";

const reportUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/reportData";
const reportsUrl = reportUrl.replace(/\/reportData(?:\?.*)?$/, "/reports");

frontendMonitor.init({
    url: reportUrl,
    projectName: "frontend-moniter-sdk-demo",
    appId: "vue-demo",
    userId: "local-developer",
    release: "demo@0.1.0",
    batchSize: 1,
});

frontendMonitor.subscribe(addReport);
frontendMonitor.performance();
frontendMonitor.behavior();
frontendMonitor.error();

async function refreshServerReports(): Promise<void> {
    try {
        const response = await fetch(reportsUrl);
        if (response.ok) {
            replaceReportsFromServer(await response.json());
        }
    } catch {
        // The demo remains usable when the optional report server is offline.
    }
}

void refreshServerReports();
window.setInterval(() => void refreshServerReports(), 500);

createApp(App)
    .use(router)
    .use(frontendMonitor)
    .mount("#app");
