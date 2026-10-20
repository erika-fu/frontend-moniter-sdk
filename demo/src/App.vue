<script setup lang="ts">
import { defineComponent, h, onBeforeUnmount, onMounted, ref } from "vue";
import {
    isReplayRecording,
    startReplayRecording,
    stopReplayRecording,
} from "./replayControl";
import {
    cancelManualNavigation,
    commitManualNavigation,
    commitRedirectNavigation,
    failResource,
    pushHistoryRoute,
    rejectPromise,
    requestWithFetch,
    requestWithXHR,
    probeSoftNavigationViewPaintSupport,
    runKeyContentPaintScenario,
    runSkeletonToContentScenario,
    runSoftNavigationViewPaintScenario,
    runViewLargestContentfulPaintScenario,
    stopSoftNavigationViewPaintDemo,
    switchRoute,
    throwJavaScriptError,
    type KeyContentPaintScenario,
    type SkeletonToContentResult,
    type ViewLargestContentfulPaintScenario,
} from "./scenarios";

const showVueError = ref(false);
const unmarkedComparisonMessage = ref("");
const viewFcpStatus = ref("");
const viewLcpStatus = ref("");
const keyContentStatus = ref("");
const softNavStatus = ref("");
let activeViewFcpScenario: SkeletonToContentResult | undefined;
let activeViewLcpScenario: ViewLargestContentfulPaintScenario | undefined;
let activeKeyContentScenario: KeyContentPaintScenario | undefined;
const monitorUrl =
    import.meta.env.VITE_MONITOR_URL ??
    "http://localhost:9800/api/v1/reportData";

const VueErrorScenario = defineComponent({
    name: "VueErrorScenario",
    props: {},
    setup() {
        onMounted(() => {
            throw new Error("demo: Vue component error");
        });
        return () => h("span");
    },
});

onBeforeUnmount(() => {
    stopReplayRecording();
    stopSoftNavigationViewPaintDemo();
    activeViewFcpScenario?.dispose();
    activeViewFcpScenario = undefined;
    activeViewLcpScenario?.dispose();
    activeViewLcpScenario = undefined;
    activeKeyContentScenario?.dispose();
    activeKeyContentScenario = undefined;
});
onMounted(() => {
    startReplayRecording();
    const support = probeSoftNavigationViewPaintSupport();
    // 仅探测支持度；不把 soft-navigation 优先态留在整个 demo 会话里，避免阻断 fallback 按钮。
    stopSoftNavigationViewPaintDemo();
    softNavStatus.value = support.supported
        ? "浏览器完整支持 Soft Navigation。点击「Soft Navigation 优先」启用原生 Measurement Source（不宣称通用 Core Web Vitals 覆盖）。"
        : `当前环境未完整支持 Soft Navigation（${support.status.status === "unsupported" ? support.status.reason : "unknown"}），继续使用 declared-content / application-mark。`;
});

function runSoftNavScenario(): void {
    activeViewFcpScenario?.dispose();
    activeViewFcpScenario = undefined;
    const support = runSoftNavigationViewPaintScenario();
    softNavStatus.value = support.supported
        ? "已提交 soft-navigation Page View，并观察原生 soft-navigation 条目。选中来源为 soft-navigation（若浏览器产出条目）；与 fallback 样本默认分开查看。"
        : `已提交 Page View，但 Soft Navigation 不可用（${support.status.status === "unsupported" ? support.status.reason : "unknown"}）。请改用 Skeleton → declared-content / application-mark。`;
}

function triggerVueError(): void {
    showVueError.value = true;
}

function acknowledgeUnmarkedClick(): void {
    unmarkedComparisonMessage.value = "未标记对照已执行";
}

function runViewFcpScenario(
    mode: "declared-content" | "application-mark",
): void {
    stopSoftNavigationViewPaintDemo();
    activeViewFcpScenario?.dispose();
    viewFcpStatus.value =
        mode === "declared-content"
            ? "已提交 Page View，正在展示 skeleton…"
            : "已提交 Page View，等待应用 mark…";
    activeViewFcpScenario = runSkeletonToContentScenario(mode, 600);
    window.setTimeout(() => {
        if (activeViewFcpScenario?.phase === "content") {
            viewFcpStatus.value =
                mode === "declared-content"
                    ? "真实内容已插入（declared-content），请在 platform 的 View Paint 中查看"
                    : "已调用 markViewFirstContentfulPaint（application-mark）";
        }
    }, 700);
}

function runViewLcpScenario(): void {
    activeViewLcpScenario?.dispose();
    viewLcpStatus.value =
        "已展示小候选。更大的广告被排除，候选替换前不会上报。";
    activeViewLcpScenario = runViewLargestContentfulPaintScenario({
        replacementDelay: 700,
        timeout: 8_000,
    });
    window.setTimeout(() => {
        if (activeViewLcpScenario?.phase === "replaced") {
            viewLcpStatus.value =
                "主内容已替换为更大的候选。广告仍然更大，但不会成为 VLCP。点击页面会以 interaction 结束观察，否则 8 秒后以 timeout 上报一次。";
        }
    }, 800);
}

function runKeyContentScenario(): void {
    activeKeyContentScenario?.dispose();
    keyContentStatus.value =
        "已展示更大的视觉区域。等待更小的任务关键价格出现…";
    activeKeyContentScenario = runKeyContentPaintScenario({
        keyDelay: 600,
        keyContentName: "product-price",
    });
    window.setTimeout(() => {
        if (activeKeyContentScenario?.phase === "key-ready") {
            keyContentStatus.value =
                "已上报 Key Content Paint（product-price）。它不是 View LCP，也不会把最大主图当成关键内容。";
        }
    }, 700);
}
</script>

<template>
    <div class="app-shell">
        <header class="topbar">
            <div>
                <p class="eyebrow">FRONTEND MONITOR SDK</p>
                <h1>SDK 场景实验台</h1>
                <p class="subtitle">
                    只负责初始化 SDK 和产生事件。请在独立 platform 中查看入库后的监控数据。
                </p>
            </div>
            <div class="recording-control" aria-label="录屏控制">
                <span
                    class="live-status"
                    :class="{ recording: isReplayRecording }"
                    aria-live="polite"
                >
                    <span class="status-dot"></span>
                    {{ isReplayRecording ? "录制中" : "未录制" }}
                </span>
                <button
                    v-if="!isReplayRecording"
                    class="action-button"
                    type="button"
                    @click="startReplayRecording"
                >
                    开始录屏
                </button>
                <button
                    v-else
                    class="action-button danger"
                    type="button"
                    @click="stopReplayRecording"
                >
                    停止录屏
                </button>
            </div>
        </header>

        <main>
            <section class="config-panel" aria-labelledby="config-title">
                <div>
                    <p class="section-kicker">SDK INITIALIZATION</p>
                    <h2 id="config-title">当前页面已启用监控采集</h2>
                </div>
                <code>{{ monitorUrl }}</code>
            </section>

            <section class="scenario-section" aria-labelledby="behavior-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">BEHAVIOR</p>
                        <h2 id="behavior-title">页面访问、点击与路由</h2>
                    </div>
                </div>
                <p class="section-note">
                    只有携带 clstag 标记的控件才会产生行为点击上报。未标记对照可以点击，但不会产生点击上报。Hash / History 切换走自动 PV（较低保真，带 startSource）。手动 Attempt 演示框架在守卫通过后提交 Page View，取消则不上报。敏感 query（如 token）会从 pageUrl 中剥离。完整分析链路：本页场景产生 Page View 与 View Paint → server 投影初始文档 FCP/LCP（scope=document）并计算 Metric Coverage → platform 性能页按 Page Name 聚合、筛选 scope / Measurement Source。
                </p>
                <div class="scenario-grid">
                    <button
                        type="button"
                        clstag="switch-hash-route-to-orders"
                        @click="switchRoute('#/scenario/orders')"
                    >
                        Hash 切到订单
                    </button>
                    <button
                        type="button"
                        clstag="switch-hash-route-to-profile"
                        @click="switchRoute('#/scenario/profile')"
                    >
                        Hash 切到个人
                    </button>
                    <button
                        type="button"
                        clstag="switch-history-route-to-orders"
                        @click="pushHistoryRoute('orders')"
                    >
                        History 切到订单
                    </button>
                    <button
                        type="button"
                        clstag="switch-history-route-to-profile"
                        @click="pushHistoryRoute('profile')"
                    >
                        History 切到个人
                    </button>
                    <button
                        type="button"
                        clstag="commit-navigation-attempt-orders"
                        @click="
                            commitManualNavigation(
                                '#/scenario/orders',
                                'orders',
                                '/scenario/orders',
                            )
                        "
                    >
                        手动提交订单页
                    </button>
                    <button
                        type="button"
                        clstag="cancel-navigation-attempt"
                        @click="cancelManualNavigation"
                    >
                        取消导航 Attempt
                    </button>
                    <button
                        type="button"
                        clstag="commit-redirect-navigation-orders"
                        @click="commitRedirectNavigation"
                    >
                        重定向后提交订单页
                    </button>
                    <button type="button" @click="acknowledgeUnmarkedClick">
                        未标记对照
                    </button>
                </div>
                <p
                    v-if="unmarkedComparisonMessage"
                    class="section-note"
                    role="status"
                >
                    {{ unmarkedComparisonMessage }}
                </p>
            </section>

            <section class="scenario-section" aria-labelledby="view-paint-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">VIEW PAINT</p>
                        <h2 id="view-paint-title">View First Contentful Paint</h2>
                    </div>
                </div>
                <p class="section-note">
                    先提交 delayed-content Page View，再展示 skeleton（不计为 VFCP），延迟后换成真实内容。declared-content 依赖
                    <code>data-view-content</code>；application-mark 由业务在内容就绪时调用
                    <code>markViewFirstContentfulPaint</code>。启用 Soft Navigation 时优先级为
                    <code>soft-navigation</code> &gt; 容器观察 &gt; <code>application-mark</code>，与文档级 FCP 相互独立，也不宣称通用 Core Web Vitals 覆盖。
                </p>
                <div class="scenario-grid">
                    <button
                        type="button"
                        clstag="view-fcp-soft-navigation"
                        @click="runSoftNavScenario"
                    >
                        Soft Navigation 优先
                    </button>
                    <button
                        type="button"
                        clstag="view-fcp-declared-content"
                        @click="runViewFcpScenario('declared-content')"
                    >
                        Skeleton → declared-content
                    </button>
                    <button
                        type="button"
                        clstag="view-fcp-application-mark"
                        @click="runViewFcpScenario('application-mark')"
                    >
                        Skeleton → application-mark
                    </button>
                </div>
                <p v-if="softNavStatus" class="section-note" role="status">
                    {{ softNavStatus }}
                </p>
                <p v-if="viewFcpStatus" class="section-note" role="status">
                    {{ viewFcpStatus }}
                </p>
            </section>

            <section class="scenario-section" aria-labelledby="view-lcp-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">VIEW PAINT</p>
                        <h2 id="view-lcp-title">View Largest Contentful Paint</h2>
                    </div>
                </div>
                <p class="section-note">
                    声明首屏区域后，小候选会被更大的主内容替换；旁边更大的广告带
                    <code>data-view-advertising</code>，默认不能成为候选。最终值只在可信交互、页面隐藏、下一次 Page View 或超时后上报一次，超时时长本身不会变成指标值。
                </p>
                <div class="scenario-grid">
                    <button
                        type="button"
                        clstag="view-lcp-candidate-replacement"
                        @click="runViewLcpScenario"
                    >
                        小候选 → 更大主内容
                    </button>
                </div>
                <p v-if="viewLcpStatus" class="section-note" role="status">
                    {{ viewLcpStatus }}
                </p>
            </section>

            <section class="scenario-section" aria-labelledby="key-content-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">VIEW PAINT</p>
                        <h2 id="key-content-title">Key Content Paint</h2>
                    </div>
                </div>
                <p class="section-note">
                    先展示更大的商品主图，再延迟插入更小的价格（
                    <code>data-key-content=&quot;product-price&quot;</code>
                    ）。Key Content Paint 只测量应用声明的任务关键目标，与 View Largest Contentful Paint 相互独立，也不是标准 Web Vital。
                </p>
                <div class="scenario-grid">
                    <button
                        type="button"
                        clstag="key-content-vs-largest-visual"
                        @click="runKeyContentScenario"
                    >
                        大主图 → 小价格关键内容
                    </button>
                </div>
                <p v-if="keyContentStatus" class="section-note" role="status">
                    {{ keyContentStatus }}
                </p>
            </section>

            <section class="scenario-section" aria-labelledby="network-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">NETWORK</p>
                        <h2 id="network-title">Fetch、XHR 与资源</h2>
                    </div>
                    <span class="section-note">
                        成功与失败都会进入 platform 性能视图
                    </span>
                </div>
                <div class="scenario-grid">
                    <button type="button" @click="requestWithFetch(true)">
                        Fetch 成功
                    </button>
                    <button type="button" @click="requestWithFetch(false)">
                        Fetch 失败
                    </button>
                    <button type="button" @click="requestWithXHR(true)">
                        XHR 成功
                    </button>
                    <button type="button" @click="requestWithXHR(false)">
                        XHR 失败
                    </button>
                    <button type="button" @click="failResource">
                        资源加载失败
                    </button>
                </div>
            </section>

            <section class="scenario-section" aria-labelledby="error-title">
                <div class="section-heading">
                    <div>
                        <p class="section-kicker">ERRORS</p>
                        <h2 id="error-title">运行时异常</h2>
                    </div>
                    <span class="section-note">
                        异常详情、聚合和状态在 platform 中查看
                    </span>
                </div>
                <div class="scenario-grid">
                    <button type="button" @click="throwJavaScriptError">
                        JavaScript 异常
                    </button>
                    <button type="button" @click="rejectPromise">
                        Promise 异常
                    </button>
                    <button type="button" @click="triggerVueError">
                        Vue 异常
                    </button>
                </div>
                <VueErrorScenario v-if="showVueError" />
            </section>
        </main>
    </div>
</template>
