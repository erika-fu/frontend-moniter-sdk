<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import type { ReplayEventReportData } from "../../../src/index.js";

const props = defineProps<{
    events: ReplayEventReportData["event"][];
    initialOffset?: number | undefined;
}>();

const target = ref<HTMLElement>();
let player: rrwebPlayer | undefined;

onMounted(() => {
    void nextTick(() => {
        if (!target.value || props.events.length === 0) {
            return;
        }

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
    });
});

onBeforeUnmount(() => {
    player?.pause();
    (
        player as rrwebPlayer & { $destroy?: () => void }
    ).$destroy?.();
    player = undefined;
});
</script>

<template>
    <div ref="target" class="replay-player" aria-label="录屏播放器"></div>
</template>
