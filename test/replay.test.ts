import { afterEach, describe, expect, it, vi } from "vitest";
import type { eventWithTime } from "@rrweb/types";

const { record } = vi.hoisted(() => ({
    record: vi.fn(),
}));

vi.mock("rrweb", () => ({ record }));

import {
    createReplayUrl,
    getReplaySession,
    observeReplay,
    stopObserveReplay,
} from "../src/replay/index.js";
import { resetReportConfig } from "../src/report.js";

describe("observeReplay", () => {
    afterEach(() => {
        stopObserveReplay();
        resetReportConfig();
        record.mockReset();
        vi.unstubAllGlobals();
    });

    it("does not start outside a browser", () => {
        observeReplay();

        expect(record).not.toHaveBeenCalled();
        expect(getReplaySession()).toBeUndefined();
    });

    it("starts a privacy-safe rrweb session and reports its events", () => {
        const onReport = vi.fn();
        const stop = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return stop;
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 25 });

        observeReplay({ onReport });
        const session = getReplaySession();
        emit?.({ type: 4, timestamp: 40, data: {} } as eventWithTime, true);

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                maskAllInputs: true,
                blockClass: "monitor-block",
                blockSelector: "[data-monitor-mask]",
            }),
        );
        expect(session).toEqual(
            expect.objectContaining({
                id: expect.stringMatching(/^replay-/),
                startTime: 25,
                startedAt: expect.any(Number),
            }),
        );
        expect(onReport).toHaveBeenCalledWith({
            type: "replay",
            subType: "event",
            replayId: session?.id,
            event: { type: 4, timestamp: 40, data: {} },
            startTime: 40,
            replayOffset: expect.any(Number),
            isCheckout: true,
        });
    });

    it("creates a seekable URL from replay error context", () => {
        expect(
            createReplayUrl("/replay", {
                replayId: "replay-1",
                replayOffset: 123.5,
            }),
        ).toBe("http://localhost/replay?replayId=replay-1&replayOffset=123.5");
    });

    it("updates the callback without starting another session", () => {
        const first = vi.fn();
        const second = vi.fn();
        const stop = vi.fn();
        record.mockReturnValue(stop);
        vi.stubGlobal("window", {});

        observeReplay({ onReport: first });
        const session = getReplaySession();
        observeReplay({ onReport: second });

        expect(record).toHaveBeenCalledTimes(1);
        expect(getReplaySession()).toEqual(session);
        stopObserveReplay();
        expect(stop).toHaveBeenCalledTimes(1);
        expect(getReplaySession()).toBeUndefined();
    });
});
