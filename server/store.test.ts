import { afterEach, describe, expect, it } from "vitest";
import { unlinkSync } from "node:fs";
import { SQLiteReportStore } from "./store.js";

const paths: string[] = [];

afterEach(() => {
    for (const path of paths.splice(0)) {
        try {
            unlinkSync(path);
        } catch {
            // The SQLite WAL files are not relevant to the test assertion.
        }
    }
});

function report(id: string, appId = "app-a") {
    return {
        protocolVersion: 1,
        id,
        appId,
        projectName: "Project",
        sessionId: "session",
        timestamp: 1000,
        release: "1.0.0",
        user: { id: "user" },
        environment: { url: "/home", userAgent: "test", language: "zh-CN" },
        data: [
            { type: "error", subType: "js", message: "boom" },
            { type: "behavior", subType: "click" },
        ],
    };
}

function errorReport(
    id: string,
    timestamp: number,
    options: {
        appId?: string;
        subType?: string;
        message?: string;
        userId?: string;
        pageUrl?: string;
        release?: string;
        stack?: string;
    } = {},
) {
    return {
        ...report(id, options.appId ?? "app-a"),
        timestamp,
        user: { id: options.userId ?? "user" },
        release: options.release ?? "1.0.0",
        environment: {
            url: options.pageUrl ?? "/home",
            userAgent: "test",
            language: "zh-CN",
        },
        data: [{
            type: "error",
            subType: options.subType ?? "js",
            msg: options.message ?? "Cannot read property 1234",
            stack: options.stack ?? "Error: boom\n    at render (app.js:10:2)\n    at main (app.js:20:2)",
        }],
    };
}

describe("SQLiteReportStore", () => {
    it("persists normalized events and ignores duplicate envelopes", () => {
        const path = `/tmp/monitoring-${Date.now()}-${Math.random()}.sqlite`;
        paths.push(path);
        const first = new SQLiteReportStore(path);
        first.save(report("one"));
        first.save(report("one"));
        expect(first.queryEvents({
            page: 1,
            pageSize: 10,
            appId: "app-a",
        }).total).toBe(2);
        first.close();

        const second = new SQLiteReportStore(path);
        expect(second.apps()).toEqual([{ appId: "app-a", projectName: "Project" }]);
        expect(second.summary({ appId: "app-a" })).toEqual({
            total: 2,
            byType: [
                { type: "behavior", count: 1 },
                { type: "error", count: 1 },
            ],
        });
        second.close();
    });

    it("keeps the filtered summary aligned with the event query", () => {
        const path = `/tmp/monitoring-${Date.now()}-${Math.random()}.sqlite`;
        paths.push(path);
        const store = new SQLiteReportStore(path);
        store.save(report("one"));

        expect(store.summary({ appId: "app-a", type: "error" })).toEqual({
            total: 1,
            byType: [{ type: "error", count: 1 }],
        });
        store.close();
    });

    it("aggregates equivalent errors while separating subtype, stack, and app", () => {
        const path = `/tmp/monitoring-${Date.now()}-${Math.random()}.sqlite`;
        paths.push(path);
        const store = new SQLiteReportStore(path);
        store.save(errorReport("one", 1000, { userId: "u1" }));
        store.save(errorReport("two", 2000, {
            userId: "u2",
            message: "Cannot   read property 9999",
        }));
        store.save(errorReport("three", 3000, { subType: "promise" }));
        store.save(errorReport("four", 4000, { appId: "app-b" }));

        const result = store.queryErrors({
            appId: "app-a",
            page: 1,
            pageSize: 10,
        });
        expect(result.total).toBe(2);
        expect(result.items[0]).toMatchObject({
            subType: "promise",
            count: 1,
        });
        expect(result.items[1]).toMatchObject({
            subType: "js",
            count: 2,
            userCount: 2,
            firstSeen: 1000,
            lastSeen: 2000,
        });
        expect(store.queryErrors({ appId: "app-b", page: 1, pageSize: 10 }).total).toBe(1);
        store.close();
    });

    it("keeps error status across restart and paginates occurrences", () => {
        const path = `/tmp/monitoring-${Date.now()}-${Math.random()}.sqlite`;
        paths.push(path);
        const first = new SQLiteReportStore(path);
        first.save(errorReport("one", 1000));
        first.save(errorReport("two", 2000, { userId: "u2" }));
        const issue = first.queryErrors({ page: 1, pageSize: 10 }).items[0];
        expect(issue).toBeDefined();
        if (!issue) throw new Error("expected an error issue");
        expect(first.errorEvents(issue.fingerprint, 1, 1).total).toBe(2);
        expect(first.errorEvents(issue.fingerprint, 1, 1).items).toHaveLength(1);
        expect(first.updateErrorStatus(issue.fingerprint, "resolved")).toBe(true);
        first.close();

        const second = new SQLiteReportStore(path);
        expect(second.getError(issue.fingerprint)?.status).toBe("resolved");
        expect(second.queryErrors({
            status: "resolved",
            page: 1,
            pageSize: 10,
        }).total).toBe(1);
        second.close();
    });

    it("cleans expired data across normalized and raw storage idempotently", () => {
        const path = `/tmp/monitoring-${Date.now()}-${Math.random()}.sqlite`;
        paths.push(path);
        const store = new SQLiteReportStore(path);
        store.save(errorReport("old", 1_000));
        store.save(errorReport("new", 10_000, { message: "new error" }));
        store.save({
            ...report("replay-old"),
            timestamp: 1_000,
            data: [{
                type: "replay",
                subType: "event",
                replayId: "old-replay",
                sessionId: "session",
                replayOffset: 0,
                event: { type: 2, timestamp: 1_000 },
            }],
        });

        expect(store.cleanupBefore(5_000)).toMatchObject({
            envelopes: 2,
            events: 2,
            errors: 1,
            replays: 1,
        });
        expect(store.queryErrors({ page: 1, pageSize: 10 }).items).toHaveLength(1);
        expect(store.queryEvents({ page: 1, pageSize: 10 }).total).toBe(1);
        expect(store.cleanupBefore(5_000)).toEqual({
            envelopes: 0,
            events: 0,
            errors: 0,
            replays: 0,
            sourceMaps: 0,
        });
        store.close();
    });
});
