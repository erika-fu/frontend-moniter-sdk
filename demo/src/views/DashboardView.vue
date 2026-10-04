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
    <main>
        <section class="summary-grid" aria-label="监控摘要">
            <article class="summary-item">
                <span class="summary-label">已采集报告</span>
                <strong>{{ reports.length }}</strong>
                <span class="summary-hint">最多保留最近 100 条</span>
            </article>
            <article class="summary-item">
                <span class="summary-label">报告类型</span>
                <strong>{{ reportTypes.length }}</strong>
                <span class="summary-hint">来自 Performance SDK</span>
            </article>
            <article class="summary-item summary-action">
                <span class="summary-label">测试请求</span>
                <strong>Fetch / XHR</strong>
                <span class="summary-hint">打开接口请求后会实时出现</span>
            </article>
        </section>

        <section class="workspace">
            <div class="workspace-heading">
                <div>
                    <p class="section-kicker">REPORT STREAM</p>
                    <h1>实时报告</h1>
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
                <p>页面加载指标会在浏览器确认后自动出现。</p>
            </div>
            <div v-else class="report-list">
                <article
                    v-for="(report, index) in visibleReports.slice(0, 5)"
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
        </section>
    </main>
</template>
