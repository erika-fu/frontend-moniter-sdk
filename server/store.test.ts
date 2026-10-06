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
});
