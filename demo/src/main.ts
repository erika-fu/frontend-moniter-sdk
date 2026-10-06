import { createApp } from "vue";
import frontendMonitor from "frontend-moniter-sdk";
import { addReport } from "./reportStore.js";
import { startReplayRecording } from "./replayControl.js";
import { router } from "./router/index.js";
import App from "./App.vue";
import "./style.css";

const reportUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/api/v1/reportData";

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

createApp(App)
    .use(router)
    .use(frontendMonitor)
    .mount("#app");

// 先挂载应用再开始录制，确保 rrweb 的首个 DOM 快照包含 demo 页面。
startReplayRecording();
