<script setup lang="ts">
import {
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
} from "vue";
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
let seekFrame: number | undefined;

function scheduleSeek(): void {
    if (seekFrame !== undefined) {
        window.cancelAnimationFrame(seekFrame);
    }
    seekFrame = window.requestAnimationFrame(seekToInitialOffset);
}

function seekToInitialOffset(): void {
    if (
        !player ||
        typeof props.initialOffset !== "number" ||
        !Number.isFinite(props.initialOffset) ||
        props.initialOffset < 0
    ) {
        return;
    }

    try {
        const totalTime = player.getMetaData().totalTime;
        const offset = Number.isFinite(totalTime)
            ? Math.min(props.initialOffset, Math.max(0, totalTime))
            : props.initialOffset;
        player.goto(offset);
    } catch {
        playerError.value = "当前录屏数据无法定位";
    }
}

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

            // rrweb-player 的 Replayer 在构造后还会异步建立 mirror，
            // 下一帧再次定位，避免初始 goto 被初始化流程覆盖。
            scheduleSeek();
        } catch {
            playerError.value = "当前录屏数据无法播放";
            player = undefined;
        }
    });
});

onBeforeUnmount(() => {
    if (seekFrame !== undefined) {
        window.cancelAnimationFrame(seekFrame);
        seekFrame = undefined;
    }
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

watch(
    () => props.initialOffset,
    () => {
        if (player) {
            scheduleSeek();
        }
    },
);
</script>

<template>
    <div v-if="playerError" class="replay-player replay-player-error">
        {{ playerError }}
    </div>
    <div v-else ref="target" class="replay-player" aria-label="录屏播放器"></div>
</template>
