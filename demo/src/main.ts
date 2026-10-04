import { createApp } from "vue";
import frontendMonitor from "../../src/index.js";
import { addReport } from "./reportStore.js";
import { router } from "./router/index.js";
import App from "./App.vue";
import "./style.css";

const reportUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/reportData";

frontendMonitor.init({
    url: reportUrl,
    projectName: "frontend-moniter-sdk-demo",
    appId: "vue-demo",
    userId: "local-developer",
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
