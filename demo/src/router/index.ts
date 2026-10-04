import { createRouter, createWebHashHistory } from "vue-router";
import AboutView from "../views/AboutView.vue";
import DashboardView from "../views/DashboardView.vue";
import ReportsView from "../views/ReportsView.vue";

export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/", component: DashboardView },
        { path: "/reports", component: ReportsView },
        { path: "/about", component: AboutView },
    ],
});
