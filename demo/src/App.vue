<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import { RouterLink, RouterView } from "vue-router";
import SourceMapUploader from "./components/SourceMapUploader.vue";
import {
    isReplayRecording,
    startReplayRecording,
    stopReplayRecording,
} from "./replayControl";

onBeforeUnmount(stopReplayRecording);
</script>

<template>
    <div class="app-shell">
        <header class="topbar">
            <RouterLink class="brand" to="/">
                <span class="eyebrow">FRONTEND MONITOR SDK</span>
                <strong>前端监控实验台</strong>
            </RouterLink>
            <div class="replay-controls" aria-label="录屏控制">
                <span
                    class="live-status"
                    :class="{ recording: isReplayRecording }"
                    aria-live="polite"
                >
                    <span class="status-dot"></span>
                    <span>
                        {{ isReplayRecording ? "录制中" : "未录制" }}
                    </span>
                </span>
                <button
                    v-if="!isReplayRecording"
                    class="replay-control-button start"
                    type="button"
                    @click="startReplayRecording"
                >
                    开启录制
                </button>
                <button
                    v-else
                    class="replay-control-button stop"
                    type="button"
                    @click="stopReplayRecording"
                >
                    停止录制
                </button>
            </div>
        </header>

        <nav class="main-nav" aria-label="主导航">
            <RouterLink to="/">监控概览</RouterLink>
            <RouterLink to="/reports">报告列表</RouterLink>
            <RouterLink to="/replay">查看录屏</RouterLink>
            <RouterLink to="/about">SDK 说明</RouterLink>
        </nav>

        <SourceMapUploader />
        <RouterView />
    </div>
</template>
