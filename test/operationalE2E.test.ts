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
});
