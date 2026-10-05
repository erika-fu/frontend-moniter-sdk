import { afterEach, describe, expect, it, vi } from "vitest";

const { getReplaySession, observeReplay, stopObserveReplay } = vi.hoisted(
    () => ({
        getReplaySession: vi.fn(),
        observeReplay: vi.fn(),
        stopObserveReplay: vi.fn(),
    }),
);

vi.mock("../src/replay/index.js", () => ({
    getReplaySession,
    observeReplay,
    stopObserveReplay,
}));

import {
    isReplayRecording,
    startReplayRecording,
    stopReplayRecording,
} from "../demo/src/replayControl.js";

describe("demo replay controls", () => {
    afterEach(() => {
        isReplayRecording.value = false;
        getReplaySession.mockReset();
        observeReplay.mockReset();
        stopObserveReplay.mockReset();
    });

    it("starts recording only through the explicit start action", () => {
        getReplaySession.mockReturnValue({
            id: "replay-1",
            startTime: 1,
            startedAt: 1,
        });

        expect(isReplayRecording.value).toBe(false);

        startReplayRecording();

        expect(observeReplay).toHaveBeenCalledTimes(1);
        expect(isReplayRecording.value).toBe(true);
    });

    it("does not show recording when rrweb could not start", () => {
        getReplaySession.mockReturnValue(undefined);

        startReplayRecording();

        expect(observeReplay).toHaveBeenCalledTimes(1);
        expect(isReplayRecording.value).toBe(false);
    });

    it("stops recording and clears the status", () => {
        isReplayRecording.value = true;

        stopReplayRecording();

        expect(stopObserveReplay).toHaveBeenCalledTimes(1);
        expect(isReplayRecording.value).toBe(false);
    });
});
