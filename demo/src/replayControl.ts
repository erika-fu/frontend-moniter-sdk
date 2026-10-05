import { ref } from "vue";
import {
    getReplaySession,
    observeReplay,
    stopObserveReplay,
} from "frontend-moniter-sdk";

export const isReplayRecording = ref(false);

export function startReplayRecording(): void {
    observeReplay();
    isReplayRecording.value = getReplaySession() !== undefined;
}

export function stopReplayRecording(): void {
    stopObserveReplay();
    isReplayRecording.value = false;
}
