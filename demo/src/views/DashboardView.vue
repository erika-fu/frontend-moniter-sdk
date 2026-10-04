<script setup lang="ts">
import { computed, ref } from "vue";
import {
    clearReports,
    getReportLocation,
    reportTypes,
    reports,
} from "../reportStore";

const activeFilter = ref("all");
const visibleReports = computed(() =>
    activeFilter.value === "all"
        ? reports.value
        : reports.value.filter(
              (report) => report.subType === activeFilter.value,
          ),
);

function requestWithFetch(): void {
    void fetch(`/sdk-demo-fetch-${Date.now()}.json`).catch(() => undefined);
}

function requestWithXHR(): void {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `/sdk-demo-xhr-${Date.now()}.json`);
    xhr.send();
}

function throwJavaScriptError(): void {
    window.setTimeout(() => {
        throw new Error("demo: JavaScript runtime error");
    });
}

function rejectPromise(): void {
    void Promise.reject(new Error("demo: unhandled Promise rejection"));
}

function failResource(): void {
    const image = new Image();
    image.hidden = true;
    image.addEventListener("error", () => image.remove(), { once: true });
    document.body.append(image);
    image.src = `/sdk-demo-resource-${Date.now()}.png`;
}

function throwVueError(): void {
    throw new Error("demo: Vue component error");
}
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
                <span class="summary-hint">行为、性能与错误数据</span>
            </article>
            <article class="summary-item summary-action">
                <span class="summary-label">上报方式</span>
                <strong>自动批量上报</strong>
                <span class="summary-hint">使用 init 中的统一配置</span>
            </article>
        </section>

        <section class="test-panel" aria-labelledby="test-panel-title">
            <div>
                <p class="section-kicker">TEST EVENTS</p>
                <h2 id="test-panel-title">触发监控事件</h2>
            </div>
            <div class="test-actions">
                <button type="button" @click="requestWithFetch">Fetch</button>
                <button type="button" @click="requestWithXHR">XHR</button>
                <button type="button" @click="throwJavaScriptError">
                    JS 异常
                </button>
                <button type="button" @click="rejectPromise">
                    Promise 异常
                </button>
                <button type="button" @click="failResource">资源异常</button>
                <button type="button" @click="throwVueError">Vue 异常</button>
            </div>
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
                <h2>还没有监控报告</h2>
                <p>触发上方事件后，采集结果会显示在这里。</p>
            </div>
            <div v-else class="report-list">
                <article
                    v-for="(report, index) in visibleReports.slice(0, 5)"
                    :key="`${report.subType}-${index}`"
                    class="report-item"
                >
                    <div class="report-meta">
                        <span class="report-type">{{ report.subType }}</span>
                        <span class="report-page">
                            {{ getReportLocation(report) }}
                        </span>
                    </div>
                    <pre>{{ JSON.stringify(report, null, 2) }}</pre>
                </article>
            </div>
        </section>
    </main>
</template>
