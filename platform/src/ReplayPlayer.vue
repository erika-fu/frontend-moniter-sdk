<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import rrwebPlayer from "rrweb-player";
import "rrweb-player/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import { formatReplayDuration } from "./replayDuration";

const props = defineProps<{
  events: eventWithTime[];
  duration: number;
  initialOffset?: number;
}>();

const target = ref<HTMLElement>();
const playerError = ref("");
let player: rrwebPlayer | undefined;
let seekFrame: number | undefined;

function seek(): void {
  if (!player || props.initialOffset === undefined) return;
  try {
    const totalTime = player.getMetaData().totalTime;
    player.goto(Math.min(props.initialOffset, Math.max(0, totalTime)));
  } catch {
    playerError.value = "当前录屏数据无法定位";
  }
}

onMounted(() => {
  void nextTick(() => {
    if (!target.value || props.events.length === 0) return;
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
      seekFrame = window.requestAnimationFrame(seek);
    } catch {
      playerError.value = "当前录屏数据无法播放";
    }
  });
});

watch(() => props.initialOffset, () => {
  if (player) {
    if (seekFrame !== undefined) window.cancelAnimationFrame(seekFrame);
    seekFrame = window.requestAnimationFrame(seek);
  }
});

onBeforeUnmount(() => {
  if (seekFrame !== undefined) window.cancelAnimationFrame(seekFrame);
  try {
    player?.pause();
    (player as rrwebPlayer & { $destroy?: () => void }).$destroy?.();
  } catch {
    // 播放器清理失败不能影响平台页面。
  }
  player = undefined;
});
</script>

<template>
  <div class="replay-player-shell">
    <div class="replay-player-meta" role="status">
      <strong>回放时长：{{ formatReplayDuration(props.duration) }}</strong>
      <span>播放器底部控制条按整秒显示，短回放以此处精确时长为准。</span>
    </div>
    <div v-if="playerError" class="replay-player replay-player-error">{{ playerError }}</div>
    <div v-else ref="target" class="replay-player" aria-label="录屏播放器"></div>
  </div>
</template>
