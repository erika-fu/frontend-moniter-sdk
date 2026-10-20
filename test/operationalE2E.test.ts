import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createReportServer } from "../server/index.js";

const fixtures: Array<{
    server: ReturnType<typeof createReportServer>;
    directory: string;
}> = [];

afterEach(async () => {
    await Promise.all(fixtures.splice(0).map(async ({ server, directory }) => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        rmSync(directory, { recursive: true, force: true });
    }));
});

describe("monitoring delivery path", () => {
    it("persists demo-shaped error, performance, and replay data for platform queries", async () => {
        const directory = mkdtempSync(`${tmpdir()}/monitoring-e2e-`);
        const server = createReportServer({
            databasePath: `${directory}/monitoring.sqlite`,
            logger: () => undefined,
        });
        fixtures.push({ server, directory });
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const ingest = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                protocolVersion: 1,
                id: "demo-e2e-report",
                appId: "vue-demo",
                projectName: "frontend-moniter-sdk-demo",
                sessionId: "demo-session",
                timestamp: 1_700_000_000_000,
                release: "demo@e2e",
                user: { id: "e2e-user" },
                environment: {
                    url: "http://localhost:4173/",
                    userAgent: "e2e",
                    language: "zh-CN",
                },
                data: [
                    {
                        type: "error",
                        subType: "js",
                        msg: "demo failure",
                        stack: "Error: demo failure\n    at checkout (app.js:1:1)",
                    },
                    {
                        type: "performance",
                        subType: "fetch",
                        url: "https://api.example.test/orders",
                        method: "GET",
                        status: 500,
                        duration: 820,
                    },
                    {
                        type: "replay",
                        subType: "event",
                        replayId: "demo-replay",
                        sessionId: "demo-session",
                        replayOffset: 0,
                        event: { type: 2, timestamp: 1_700_000_000_000 },
                    },
                ],
            }),
        });
        expect(ingest.status).toBe(202);

        const errors = await (await fetch(
            `${baseUrl}/api/v1/errors?appId=vue-demo`,
        )).json() as { items: Array<{ message: string }> };
        expect(errors.items[0]?.message).toBe("demo failure");

        const performance = await (await fetch(
            `${baseUrl}/api/v1/performance/requests?appId=vue-demo`,
        )).json() as { items: Array<{ url: string; status: number }> };
        expect(performance.items[0]).toMatchObject({
            url: "https://api.example.test/orders",
            status: 500,
        });

        const replays = await (await fetch(
            `${baseUrl}/api/v1/replays?appId=vue-demo`,
        )).json() as { items: Array<{ replayId: string }> };
        expect(replays.items[0]?.replayId).toBe("demo-replay");
    });

    it("covers Page View paint ingestion, document projection, coverage, and scope filters", async () => {
        const directory = mkdtempSync(`${tmpdir()}/monitoring-view-paint-e2e-`);
        const server = createReportServer({
            databasePath: `${directory}/monitoring.sqlite`,
            logger: () => undefined,
        });
        fixtures.push({ server, directory });
        await new Promise<void>((resolve) => {
            server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;

        const ingest = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                protocolVersion: 1,
                id: "view-paint-e2e-report",
                appId: "vue-demo",
                projectName: "frontend-moniter-sdk-demo",
                sessionId: "demo-session",
                timestamp: 1_700_000_000_100,
                release: "demo@e2e",
                user: { id: "e2e-user" },
                environment: {
                    url: "http://localhost:4173/",
                    userAgent: "e2e",
                    language: "zh-CN",
                },
                data: [
                    {
                        type: "behavior",
                        subType: "pv",
                        viewId: "view-home",
                        pageName: "home",
                        routePattern: "/",
                        startSource: "initial",
                        pageUrl: "http://localhost:4173/",
                        startTime: 0,
                        referrer: "",
                        uuid: "pv-home",
                    },
                    {
                        type: "behavior",
                        subType: "pv",
                        viewId: "view-orders",
                        pageName: "orders",
                        routePattern: "/scenario/orders",
                        startSource: "navigation",
                        pageUrl: "http://localhost:4173/#/scenario/orders",
                        startTime: 20,
                        referrer: "http://localhost:4173/",
                        uuid: "pv-orders",
                    },
                    {
                        type: "performance",
                        subType: "first-contentful-paint",
                        value: 210,
                        pageUrl: "http://localhost:4173/",
                    },
                    {
                        type: "performance",
                        subType: "view-first-contentful-paint",
                        value: 140,
                        pageUrl: "http://localhost:4173/#/scenario/orders",
                        viewId: "view-orders",
                        pageName: "orders",
                        routePattern: "/scenario/orders",
                        measurementSource: "declared-content",
                        startSource: "navigation",
                    },
                    {
                        type: "performance",
                        subType: "view-largest-contentful-paint",
                        value: 320,
                        pageUrl: "http://localhost:4173/#/scenario/orders",
                        viewId: "view-orders",
                        pageName: "orders",
                        measurementSource: "declared-region",
                        startSource: "navigation",
                        finalizationReason: "interaction",
                    },
                ],
            }),
        });
        expect(ingest.status).toBe(202);

        const documentScoped = await (await fetch(
            `${baseUrl}/api/v1/performance/view-paint?appId=vue-demo&metrics=view-first-contentful-paint&scope=document`,
        )).json() as {
            metrics: Array<{
                sampleCount: number;
                measurablePageViewCount: number;
                metricCoverage: number | null;
                pages: Array<{ pageKey: string }>;
                sources: Array<{ scope: string; measurementSource: string }>;
            }>;
        };
        expect(documentScoped.metrics[0]).toMatchObject({
            sampleCount: 1,
            measurablePageViewCount: 1,
            metricCoverage: 1,
            pages: [expect.objectContaining({ pageKey: "home" })],
            sources: [
                expect.objectContaining({
                    scope: "document",
                    measurementSource: "document",
                }),
            ],
        });

        const viewScoped = await (await fetch(
            `${baseUrl}/api/v1/performance/view-paint?appId=vue-demo&metrics=view-first-contentful-paint,view-largest-contentful-paint&scope=view`,
        )).json() as {
            metrics: Array<{
                metric: string;
                sampleCount: number;
                measurablePageViewCount: number;
                metricCoverage: number | null;
                pages: Array<{ pageKey: string }>;
            }>;
        };
        expect(viewScoped.metrics).toEqual([
            expect.objectContaining({
                metric: "view-first-contentful-paint",
                sampleCount: 1,
                measurablePageViewCount: 2,
                metricCoverage: 0.5,
                pages: [expect.objectContaining({ pageKey: "orders" })],
            }),
            expect.objectContaining({
                metric: "view-largest-contentful-paint",
                sampleCount: 1,
                measurablePageViewCount: 2,
                metricCoverage: 0.5,
            }),
        ]);

        const separated = await (await fetch(
            `${baseUrl}/api/v1/performance/view-paint?appId=vue-demo&metrics=view-first-contentful-paint&measurementSource=declared-content`,
        )).json() as {
            metrics: Array<{
                sampleCount: number;
                sources: Array<{
                    scope: string;
                    measurementSource: string;
                    startSource: string;
                }>;
            }>;
        };
        expect(separated.metrics[0]).toMatchObject({
            sampleCount: 1,
            sources: [
                expect.objectContaining({
                    scope: "view",
                    measurementSource: "declared-content",
                    startSource: "navigation",
                }),
            ],
        });
    });
});
