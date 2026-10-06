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
        emit?.({ type: 4, timestamp: 30, data: {} } as unknown as eventWithTime);
        emit?.({ type: 2, timestamp: 40, data: {} } as unknown as eventWithTime, true);
        emit?.({ type: 3, timestamp: 50, data: {} } as unknown as eventWithTime);

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                maskAllInputs: true,
                blockClass: "monitor-block",
                blockSelector: "[data-monitor-mask]",
                sampling: {
                    mouseInteraction: true,
                    mousemove: false,
                },
            }),
        );
        expect(session).toEqual(
            expect.objectContaining({
                id: expect.stringMatching(/^replay-/),
                replayId: expect.stringMatching(/^replay-/),
                sessionId: expect.stringMatching(/^session-/),
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

    it("waits for the full snapshot when an error happens during rrweb startup", () => {
        vi.useFakeTimers();
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});
        vi.stubGlobal("performance", { now: () => 10 });

        observeReplay({ onReport, postErrorDuration: 0 });
        const replay = getReplaySession()!;
        emit?.({ type: 4, timestamp: replay.startedAt, data: {} } as unknown as eventWithTime);

        flushReplayOnError({
            replayId: replay.replayId,
            sessionId: replay.sessionId,
            replayOffset: 0,
        });

        expect(onReport).not.toHaveBeenCalled();

        emit?.({ type: 2, timestamp: replay.startedAt + 5, data: {} } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 25, data: {} } as unknown as eventWithTime);
        vi.runAllTimers();

        expect(onReport.mock.calls.map(([report]) => report.event.type)).toEqual([4, 2, 3]);
        expect(onReport.mock.calls.map(([report]) => report.replayOffset)).toEqual([0, 5, 25]);
    });

    it("keeps waiting when the snapshot misses the post-error window", () => {
        vi.useFakeTimers();
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});

        observeReplay({ onReport, postErrorDuration: 10 });
        const replay = getReplaySession()!;
        emit?.({ type: 4, timestamp: replay.startedAt, data: {} } as unknown as eventWithTime);
        flushReplayOnError();
        vi.advanceTimersByTime(10);

        expect(onReport).not.toHaveBeenCalled();

        emit?.({ type: 2, timestamp: replay.startedAt + 20, data: {} } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 30, data: {} } as unknown as eventWithTime);
        vi.runAllTimers();

        expect(onReport.mock.calls.map(([report]) => report.event.type)).toEqual([4, 2, 3]);
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
        emit?.({ type: 2, timestamp: 100, data: {} } as unknown as eventWithTime);
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
        const firstSession = getReplaySession()!;
        emit?.({ type: 4, timestamp: 20, data: {} } as unknown as eventWithTime);
        emit?.({ type: 2, timestamp: 30, data: {} } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: 40, data: {} } as unknown as eventWithTime);

        flushReplayOnError();
        expect(onReport.mock.calls.map(([report]) => report.event.timestamp)).toEqual(
            [20, 30, 40],
        );

        const nextSession = getReplaySession()!;
        expect(nextSession.replayId).not.toBe(firstSession.replayId);
        expect(nextSession.sessionId).toBe(firstSession.sessionId);
        onReport.mockClear();
        emit?.({
            type: 4,
            timestamp: nextSession.startedAt,
            data: {},
        } as unknown as eventWithTime);
        emit?.({
            type: 2,
            timestamp: nextSession.startedAt + 1,
            data: {},
        } as unknown as eventWithTime);
        emit?.({
            type: 3,
            timestamp: nextSession.startedAt + 2,
            data: {},
        } as unknown as eventWithTime);
        flushReplayOnError();
        expect(onReport.mock.calls).toHaveLength(3);
        expect(
            onReport.mock.calls.every(
                ([report]) => report.sessionId === nextSession.sessionId,
            ),
        ).toBe(true);
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
        } as unknown as eventWithTime);
        emit?.({
            type: 2,
            timestamp: session.startedAt + 10,
            data: {},
        } as unknown as eventWithTime);

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

    it("preserves pre-error events when the post-error tail is busy", () => {
        vi.useFakeTimers();
        const onReport = vi.fn();
        let emit: ((event: eventWithTime, isCheckout?: boolean) => void) | undefined;
        record.mockImplementation((options) => {
            emit = options.emit;
            return vi.fn();
        });
        vi.stubGlobal("window", {});

        observeReplay({ onReport, bufferSize: 2, postErrorDuration: 10 });
        const replay = getReplaySession()!;
        emit?.({ type: 2, timestamp: replay.startedAt, data: {} } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 1, data: { value: "before-1" } } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 2, data: { value: "before-2" } } as unknown as eventWithTime);
        flushReplayOnError();
        emit?.({ type: 3, timestamp: replay.startedAt + 3, data: { value: "after-1" } } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 4, data: { value: "after-2" } } as unknown as eventWithTime);
        emit?.({ type: 3, timestamp: replay.startedAt + 5, data: { value: "after-3" } } as unknown as eventWithTime);
        vi.advanceTimersByTime(10);

        expect(onReport.mock.calls.map(([report]) => report.event.data?.value)).toEqual([
            undefined, "before-1", "before-2", "after-2", "after-3",
        ]);
    });

    it("ignores stale replay contexts and late events from an old recorder", () => {
        vi.useFakeTimers();
        const onReport = vi.fn();
        const emits: Array<(event: eventWithTime, isCheckout?: boolean) => void> = [];
        record.mockImplementation((options) => {
            emits.push(options.emit);
            return vi.fn();
        });
        vi.stubGlobal("window", {});

        observeReplay({ onReport, postErrorDuration: 0 });
        const first = getReplaySession()!;
        emits[0]?.({ type: 2, timestamp: first.startedAt, data: {} } as unknown as eventWithTime);
        const context = { replayId: first.replayId, sessionId: first.sessionId, replayOffset: 0 };
        flushReplayOnError(context);
        const second = getReplaySession()!;
        emits[1]?.({ type: 2, timestamp: second.startedAt, data: {} } as unknown as eventWithTime);
        emits[0]?.({ type: 3, timestamp: first.startedAt + 1, data: { value: "stale" } } as unknown as eventWithTime);
        flushReplayOnError(context);
        expect(getReplaySession()?.replayId).toBe(second.replayId);
        expect(onReport.mock.calls.map(([report]) => report.event.data?.value)).not.toContain("stale");
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
