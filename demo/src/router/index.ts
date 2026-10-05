import { createRouter, createWebHashHistory } from "vue-router";
import AboutView from "../views/AboutView.vue";
import DashboardView from "../views/DashboardView.vue";
import ReportsView from "../views/ReportsView.vue";
import ReplayView from "../views/ReplayView.vue";

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/", component: DashboardView },
        { path: "/reports", component: ReportsView },
        { path: "/replay", component: ReplayView },
        { path: "/about", component: AboutView },
    ],
});
