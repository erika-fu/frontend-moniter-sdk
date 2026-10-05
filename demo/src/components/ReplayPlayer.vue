<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import type { ReplayEventReportData } from "frontend-moniter-sdk";

const props = defineProps<{
    events: ReplayEventReportData["event"][];
    initialOffset?: number | undefined;
}>();

const target = ref<HTMLElement>();
const playerError = ref("");
let player: rrwebPlayer | undefined;

onMounted(() => {
    void nextTick(() => {
        if (!target.value || props.events.length === 0) {
            return;
        }

        try {
            player = new rrwebPlayer({
                target: target.value,
                props: {
                    events: props.events,
                    autoPlay: false,
                    width: 960,
                    height: 540,
                    maxScale: 1,
                },
            });

            if (
                typeof props.initialOffset === "number" &&
                Number.isFinite(props.initialOffset) &&
                props.initialOffset > 0
            ) {
                player.goto(props.initialOffset);
            }
        } catch {
            playerError.value = "当前录屏数据无法播放";
            player = undefined;
        }
    });
});

onBeforeUnmount(() => {
    try {
        player?.pause();
        (
            player as rrwebPlayer & { $destroy?: () => void }
        ).$destroy?.();
    } catch {
        // 播放器清理失败不能影响 demo 页面。
    }
    player = undefined;
});
</script>

<template>
    <div v-if="playerError" class="replay-player replay-player-error">
        {{ playerError }}
    </div>
    <div v-else ref="target" class="replay-player" aria-label="录屏播放器"></div>
</template>
