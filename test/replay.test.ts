import { afterEach, describe, expect, it, vi } from "vitest";
import type { eventWithTime } from "@rrweb/types";

const { record } = vi.hoisted(() => ({
    record: vi.fn(),
}));

vi.mock("rrweb", () => ({ record }));

import {
    createReplayUrl,
    flushReplayOnError,
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
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("does not start outside a browser", () => {
        observeReplay();

        expect(record).not.toHaveBeenCalled();
        expect(getReplaySession()).toBeUndefined();
    });

    it("buffers rrweb events until an error flushes the session", () => {
        const onReport = vi.fn();
        const stop = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return stop;
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 25 });

        observeReplay({ onReport, postErrorDuration: 0 });
        const session = getReplaySession();
        emit?.({ type: 4, timestamp: 30, data: {} } as eventWithTime);
        emit?.({ type: 2, timestamp: 40, data: {} } as eventWithTime, true);
        emit?.({ type: 3, timestamp: 50, data: {} } as eventWithTime);

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
                sessionId: expect.stringMatching(/^replay-/),
                startTime: 25,
                startedAt: expect.any(Number),
            }),
        );
        expect(onReport).not.toHaveBeenCalled();

        flushReplayOnError({
            replayId: session!.id,
            sessionId: session!.sessionId,
            replayOffset: 50,
        });

        expect(onReport).toHaveBeenCalledWith({
            type: "replay",
            subType: "event",
            replayId: session?.id,
            sessionId: session?.sessionId,
            event: { type: 2, timestamp: 40, data: {} },
            startTime: 40,
            replayOffset: expect.any(Number),
            isCheckout: true,
        });
        expect(onReport).toHaveBeenCalledWith(
            expect.objectContaining({
                event: { type: 3, timestamp: 50, data: {} },
                sessionId: session?.sessionId,
            }),
        );
    });

    it("creates a seekable URL from replay error context", () => {
        expect(
            createReplayUrl("/replay", {
                replayId: "replay-1",
                replayOffset: 123.5,
            }),
        ).toBe("http://localhost/replay?replayId=replay-1&replayOffset=123.5");
    });

    it("keeps the snapshot and only the newest events in the ring buffer", () => {
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 10 });

        observeReplay({
            onReport,
            bufferSize: 2,
            postErrorDuration: 0,
        });
        emit?.({ type: 2, timestamp: 100, data: {} } as eventWithTime);
        emit?.({ type: 3, timestamp: 101, data: { value: 1 } } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: 102, data: { value: 2 } } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: 103, data: { value: 3 } } as unknown as eventWithTime);

        flushReplayOnError();

        expect(onReport.mock.calls.map(([report]) => report.event.timestamp)).toEqual(
            [100, 102, 103],
        );
    });

    it("keeps rrweb bootstrap events and the snapshot across error flushes", () => {
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 10 });

        observeReplay({ onReport, postErrorDuration: 0 });
        emit?.({ type: 4, timestamp: 20, data: {} } as eventWithTime);
        emit?.({ type: 2, timestamp: 30, data: {} } as eventWithTime);
        emit?.({ type: 3, timestamp: 40, data: {} } as unknown as eventWithTime);

        flushReplayOnError();
        expect(onReport.mock.calls.map(([report]) => report.event.timestamp)).toEqual(
            [20, 30, 40],
        );

        onReport.mockClear();
        emit?.({ type: 3, timestamp: 50, data: {} } as unknown as eventWithTime);
        flushReplayOnError();
        expect(onReport.mock.calls.map(([report]) => report.event.timestamp)).toEqual(
            [20, 30, 50],
        );
    });

    it("includes events recorded during the post-error window", () => {
        vi.useFakeTimers();
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 10 });

        observeReplay({ onReport });
        const session = getReplaySession()!;
        emit?.({
            type: 4,
            timestamp: session.startedAt,
            data: {},
        } as eventWithTime);
        emit?.({
            type: 2,
            timestamp: session.startedAt + 10,
            data: {},
        } as eventWithTime);

        flushReplayOnError({
            replayId: session.id,
            sessionId: session.sessionId,
            replayOffset: 100,
        });
        emit?.({
            type: 3,
            timestamp: session.startedAt + 1000,
            data: {},
        } as unknown as eventWithTime);

        vi.advanceTimersByTime(1999);
        expect(onReport).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(
            onReport.mock.calls.map(([report]) => report.replayOffset),
        ).toEqual([0, 10, 1000]);
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
