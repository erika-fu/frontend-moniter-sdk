<script setup lang="ts">
import { computed, ref } from "vue";
import { clearReports, reportTypes, reports } from "../reportStore";

const activeFilter = ref("all");
const visibleReports = computed(() =>
    activeFilter.value === "all"
        ? reports.value
        : reports.value.filter(
              (report) => report.subType === activeFilter.value,
          ),
);
</script>

<template>
    <main class="workspace page-workspace">
        <div class="workspace-heading">
            <div>
                <p class="section-kicker">ALL REPORTS</p>
                <h1>报告列表</h1>
            </div>
            <button
                class="clear-button"
                type="button"
                :disabled="reports.length === 0"
                @click="clearReports"
            >
                清空报告
            </button>
        </div>

        <div class="filter-row" aria-label="报告筛选">
            <button
                class="filter-button"
                :class="{ active: activeFilter === 'all' }"
                type="button"
                @click="activeFilter = 'all'"
            >
                全部 <span>{{ reports.length }}</span>
            </button>
            <button
                v-for="item in reportTypes"
                :key="item.name"
                class="filter-button"
                :class="{ active: activeFilter === item.name }"
                type="button"
                @click="activeFilter = item.name"
            >
                {{ item.name }} <span>{{ item.count }}</span>
            </button>
        </div>

        <div v-if="visibleReports.length === 0" class="empty-state">
            <div class="empty-mark">0</div>
            <h2>还没有性能报告</h2>
            <p>返回概览或触发请求后，报告会显示在这里。</p>
        </div>
        <div v-else class="report-list">
            <article
                v-for="(report, index) in visibleReports"
                :key="`${report.subType}-${index}`"
                class="report-item"
            >
                <div class="report-meta">
                    <span class="report-type">{{ report.subType }}</span>
                    <span class="report-page">{{ report.pageUrl }}</span>
                </div>
                <pre>{{ JSON.stringify(report, null, 2) }}</pre>
            </article>
        </div>
    </main>
</template>
