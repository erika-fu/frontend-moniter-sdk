import { unlinkSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createReportServer } from "../server/index.js";
import { SQLiteReportStore } from "../server/store.js";

const servers: ReturnType<typeof createReportServer>[] = [];
const databases: string[] = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    })));
    for (const path of databases.splice(0)) {
        try {
            unlinkSync(path);
        } catch {
            // The database may already be absent when SQLite was closed.
        }
    }
});

function report(timestamp: number, data: unknown[]): Record<string, unknown> {
    return {
        protocolVersion: 1,
        id: `envelope-${timestamp}`,
        appId: "performance-app",
        projectName: "Performance",
        sessionId: "session",
        timestamp,
        release: "1.0.0",
        user: { id: "user" },
        environment: {
            url: "https://example.test/home",
            userAgent: "test",
            language: "zh-CN",
        },
        data,
    };
}

async function start(databasePath: string): Promise<string> {
    const server = createReportServer({ databasePath, logger: () => undefined });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

describe("performance analysis", () => {
    it("calculates deterministic percentiles, trend buckets, and page rankings", () => {
        const databasePath = `/tmp/performance-store-${Date.now()}-${Math.random()}.sqlite`;
        databases.push(databasePath);
        const store = new SQLiteReportStore(databasePath);
        [10, 20, 30, 40].forEach((duration, index) => {
            store.save(report(index * 3_600_000, [{
                type: "performance",
                subType: "load",
                duration,
                pageUrl: index % 2 ? "https://example.test/slow" : "https://example.test/home",
            }]));
        });

        expect(store.performanceMetrics({
            appId: "performance-app",
            from: 0,
            to: 4 * 3_600_000,
            metrics: ["load"],
        })).toEqual([expect.objectContaining({
            metric: "load",
            sampleCount: 4,
            p50: 25,
            p75: 32.5,
            p95: 38.5,
            trend: [
                expect.objectContaining({ bucket: 0, sampleCount: 1, p50: null }),
                expect.objectContaining({ bucket: 3_600_000, sampleCount: 1, p50: null }),
                expect.objectContaining({ bucket: 7_200_000, sampleCount: 1, p50: null }),
                expect.objectContaining({ bucket: 10_800_000, sampleCount: 1, p50: null }),
            ],
            pages: [
                expect.objectContaining({ pageUrl: "https://example.test/slow", p50: 30 }),
                expect.objectContaining({ pageUrl: "https://example.test/home", p50: 20 }),
            ],
        })]);
        store.close();
    });

    it("filters and paginates requests and resources through the HTTP API", async () => {
        const databasePath = `/tmp/performance-api-${Date.now()}-${Math.random()}.sqlite`;
        databases.push(databasePath);
        const baseUrl = await start(databasePath);
        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report(1_700_000_000_000, [
                {
                    type: "performance", subType: "fetch", url: "https://api.test/users",
                    method: "GET", status: 200, duration: 240, success: true,
                },
                {
                    type: "performance", subType: "xhr", url: "https://api.test/orders",
                    method: "GET", status: 500, duration: 80, success: false,
                },
                {
                    type: "performance", subType: "resource", name: "https://cdn.test/app.js",
                    sourceType: "script", duration: 320, transferSize: 20, resourceSize: 40,
                },
            ])),
        });
        expect(response.status).toBe(202);

        const requests = await (await fetch(
            `${baseUrl}/api/v1/performance/requests?appId=performance-app&status=500&keyword=orders&pageSize=1`,
        )).json() as { total: number; items: Array<{ url: string; duration: number }> };
        expect(requests).toMatchObject({
            total: 1,
            items: [{ url: "https://api.test/orders", duration: 80 }],
        });

        const resources = await (await fetch(
            `${baseUrl}/api/v1/performance/resources?appId=performance-app&resourceType=script&sort=duration`,
        )).json() as { total: number; items: Array<{ url: string; resourceType: string }> };
        expect(resources).toMatchObject({
            total: 1,
            items: [{ url: "https://cdn.test/app.js", resourceType: "script" }],
        });
    });
});
