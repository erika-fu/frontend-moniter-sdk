import { createApp } from "vue";
import frontendMonitor from "frontend-moniter-sdk";
import App from "./App.vue";
import { startDemoMonitoring } from "./startMonitoring";
import "./style.css";

// 默认开启 autoPageView：Hash / History 地址变化会自动记 PV。
// 行为点击只上报带 clstag 的控件。
startDemoMonitoring(frontendMonitor, {
    url: import.meta.env.VITE_MONITOR_URL,
    projectName: import.meta.env.VITE_MONITOR_PROJECT,
    appId: import.meta.env.VITE_MONITOR_APP_ID,
    userId: import.meta.env.VITE_MONITOR_USER_ID,
    release: import.meta.env.VITE_MONITOR_RELEASE,
});

createApp(App).use(frontendMonitor).mount("#app");
