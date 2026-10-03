import { createApp } from "vue";
import { observePerformance } from "../performance/index.js";
import { reports } from "./reportStore.js";
import { router } from "./router/index.js";
import App from "./App.vue";
import "./style.css";

observePerformance({
    onReport(report) {
        reports.value = [report, ...reports.value].slice(0, 100);
    },
});

createApp(App).use(router).mount("#app");
