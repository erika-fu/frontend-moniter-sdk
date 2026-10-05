<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ReplayPlayer from "../components/ReplayPlayer.vue";
import { replaySessions } from "../reportStore";

const route = useRoute();
const router = useRouter();
const selectedId = ref(
    typeof route.query.replayId === "string"
        ? route.query.replayId
        : replaySessions.value[0]?.id,
);

const selectedSession = computed(() =>
    replaySessions.value.find((session) => session.id === selectedId.value),
);
const initialOffset = computed(() => {
    const value = Number(route.query.replayOffset);
    if (
        !selectedSession.value ||
        !Number.isFinite(value) ||
        value <= selectedSession.value.firstReplayOffset
    ) {
        return undefined;
    }
    return value - selectedSession.value.firstReplayOffset;
});

function selectSession(id: string): void {
    selectedId.value = id;
    void router.replace({
        query: { replayId: id },
    });
}

watch(
    () => route.query.replayId,
    (id) => {
        if (typeof id === "string") {
            selectedId.value = id;
        }
    },
);
</script>

<template>
    <main class="workspace page-workspace replay-page">
        <div class="workspace-heading">
            <div>
                <p class="section-kicker">SESSION REPLAY</p>
                <h1>查看录屏</h1>
            </div>
            <span class="replay-count">{{ replaySessions.length }} 个会话</span>
        </div>

        <div v-if="replaySessions.length === 0" class="empty-state">
            <div class="empty-mark">0</div>
            <h2>还没有录屏会话</h2>
            <p>返回概览并操作页面，录屏事件会自动出现在这里。</p>
        </div>

        <div v-else class="replay-layout">
            <aside class="replay-sessions" aria-label="录屏会话">
                <button
                    v-for="session in replaySessions"
                    :key="session.id"
                    class="replay-session"
                    :class="{ active: selectedId === session.id }"
                    type="button"
                    @click="selectSession(session.id)"
                >
                    <strong>{{ session.id }}</strong>
                    <span>
                        {{ session.events.length }} 个事件 ·
                        {{ Math.round(session.lastTimestamp - session.firstTimestamp) }} ms
                    </span>
                </button>
            </aside>

            <section v-if="selectedSession" class="replay-stage">
                <div class="replay-stage-heading">
                    <div>
                        <span class="section-kicker">PLAYBACK</span>
                        <h2>{{ selectedSession.id }}</h2>
                    </div>
                    <span>{{ selectedSession.events.length }} 个事件</span>
                </div>
                <ReplayPlayer
                    :key="selectedSession.id"
                    :events="selectedSession.events"
                    v-bind="
                        initialOffset === undefined
                            ? {}
                            : { initialOffset }
                    "
                />
            </section>
            <section v-else class="replay-stage replay-missing">
                <h2>录屏会话不可用</h2>
                <p>该会话尚未采集，或已不在当前 demo 的本地数据中。</p>
            </section>
        </div>
    </main>
</template>
