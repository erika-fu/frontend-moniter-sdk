import { afterEach, describe, expect, it } from "vitest";
import type { ReplayEventReportData } from "../src/index.js";
import {
    addReport,
    clearReports,
    getReplayRoute,
    replaySessions,
} from "../demo/src/reportStore.js";

function replayReport(
    replayId: string,
    timestamp: number,
    replayOffset: number,
): ReplayEventReportData {
    return {
        type: "replay",
        subType: "event",
        replayId,
        event: { type: 4, timestamp, data: {} } as ReplayEventReportData["event"],
        startTime: timestamp,
        replayOffset,
    };
}

describe("demo replay store", () => {
    afterEach(() => {
        clearReports();
    });

    it("groups replay events and keeps their playback order", () => {
        addReport(replayReport("replay-1", 300, 200));
        addReport(replayReport("replay-1", 100, 0));

        expect(replaySessions.value[0]).toMatchObject({
            id: "replay-1",
            firstReplayOffset: 0,
            firstTimestamp: 100,
            lastTimestamp: 300,
        });
        expect(replaySessions.value[0]?.events.map((event) => event.timestamp)).toEqual(
            [100, 300],
        );
    });

    it("creates a seekable replay route from error context", () => {
        const report = {
            type: "error",
            subType: "js",
            pageUrl: "http://localhost/",
            msg: "boom",
            url: "http://localhost/",
            lineNo: 1,
            columnNo: 1,
            startTime: 1,
            replayId: "replay-1",
            replayOffset: 123,
        } as const;

        expect(getReplayRoute(report)).toEqual({
            path: "/replay",
            query: { replayId: "replay-1", replayOffset: "123" },
        });
    });
});
