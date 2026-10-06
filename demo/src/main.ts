import { createApp } from "vue";
import frontendMonitor from "frontend-moniter-sdk";
import App from "./App.vue";
import "./style.css";

const reportUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/api/v1/reportData";

frontendMonitor.init({
    url: reportUrl,
    projectName:
        import.meta.env.VITE_MONITOR_PROJECT ??
        "frontend-moniter-sdk-demo",
    appId: import.meta.env.VITE_MONITOR_APP_ID ?? "vue-demo",
    userId: import.meta.env.VITE_MONITOR_USER_ID ?? "local-developer",
    release: import.meta.env.VITE_MONITOR_RELEASE ?? "demo@0.1.0",
    batchSize: 20,
});

frontendMonitor.performance();
frontendMonitor.behavior();
frontendMonitor.error();

createApp(App).use(frontendMonitor).mount("#app");
