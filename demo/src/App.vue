<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
</script>

<template>
    <div class="app-shell">
        <header class="topbar">
            <RouterLink class="brand" to="/">
                <span class="eyebrow">FRONTEND MONITOR SDK</span>
                <strong>性能监控实验台</strong>
            </RouterLink>
            <div class="live-status" aria-label="监听状态">
                <span class="status-dot"></span>
                <span>正在监听</span>
            </div>
        </header>

        <nav class="main-nav" aria-label="主导航">
            <RouterLink to="/">监控概览</RouterLink>
            <RouterLink to="/reports">报告列表</RouterLink>
            <RouterLink to="/about">SDK 说明</RouterLink>
        </nav>

        <RouterView />
    </div>
</template>
