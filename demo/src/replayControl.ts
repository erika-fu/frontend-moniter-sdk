import { ref } from "vue";
import {
    getReplaySession,
    observeReplay,
    stopObserveReplay,
} from "../../src/replay/index.js";

export const isReplayRecording = ref(false);

export function startReplayRecording(): void {
    observeReplay();
    isReplayRecording.value = getReplaySession() !== undefined;
}

export function stopReplayRecording(): void {
    stopObserveReplay();
    isReplayRecording.value = false;
}
