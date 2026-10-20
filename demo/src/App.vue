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
    switchRoute,
    throwJavaScriptError,
} from "./scenarios";

const showVueError = ref(false);
const unmarkedComparisonMessage = ref("");
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

onBeforeUnmount(stopReplayRecording);
onMounted(startReplayRecording);

function triggerVueError(): void {
    showVueError.value = true;
}

function acknowledgeUnmarkedClick(): void {
    unmarkedComparisonMessage.value = "未标记对照已执行";
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
                    只有携带 clstag 标记的控件才会产生行为点击上报。未标记对照可以点击，但不会产生点击上报。Hash / History 切换走自动 PV（较低保真，带 startSource）。手动 Attempt 演示框架在守卫通过后提交 Page View，取消则不上报。敏感 query（如 token）会从 pageUrl 中剥离。
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
