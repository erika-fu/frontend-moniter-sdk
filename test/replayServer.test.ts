import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportServer } from "../server/index.js";

const servers: Array<{
    server: ReturnType<typeof createReportServer>;
    directory: string;
}> = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map(async ({ server, directory }) => {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        });
        rmSync(directory, { recursive: true, force: true });
    }));
});

async function startServer(): Promise<string> {
    const directory = mkdtempSync(`${tmpdir()}/replay-server-`);
    const server = createReportServer({
        databasePath: `${directory}/monitoring.sqlite`,
        logger: vi.fn(),
    });
    servers.push({ server, directory });
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
}

function report(
    data: unknown[],
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        protocolVersion: 1,
        id: `report-${Math.random()}`,
        appId: "checkout",
        projectName: "Checkout",
        sessionId: "browser-session",
        timestamp: 1_700_000_000_000,
        release: "web@1.0.0",
        user: { id: "user-1" },
        environment: {
            url: "https://shop.test/cart",
            userAgent: "test",
            language: "zh-CN",
        },
        data,
        ...overrides,
    };
}

function replayEvent(
    replayOffset: number,
    event: Record<string, unknown>,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        type: "replay",
        subType: "event",
        replayId: "replay-1",
        sessionId: "browser-session",
        replayOffset,
        event,
        ...extra,
    };
}

describe("persistent replay API", () => {
    it("lists app-scoped sessions and returns playable events with error counts", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report([
                replayEvent(0, { type: 2, timestamp: 1_700_000_000_000 }),
                replayEvent(250, { type: 3, timestamp: 1_700_000_000_250 }),
                {
                    type: "error",
                    subType: "js",
                    msg: "cart failed",
                    stack: "Error: cart failed",
                    replayId: "replay-1",
                    replayOffset: 250,
                },
            ])),
        });

        expect(response.status).toBe(202);
        const list = await fetch(
            `${baseUrl}/api/v1/replays?appId=checkout&userId=user-1&pageSize=10`,
        );
        expect(await list.json()).toMatchObject({
            total: 1,
            items: [{
                replayId: "replay-1",
                eventCount: 2,
                errorCount: 1,
                duration: 250,
                status: "ready",
            }],
        });

        const detail = await fetch(
            `${baseUrl}/api/v1/replays/replay-1?appId=checkout`,
        );
        expect(await detail.json()).toMatchObject({
            session: { replayId: "replay-1" },
            events: [
                { replayOffset: 0, event: { type: 2 } },
                { replayOffset: 250, event: { type: 3 } },
            ],
        });
        expect(
            (await fetch(`${baseUrl}/api/v1/replays/replay-1?appId=other`)).status,
        ).toBe(404);
    });

    it("returns a stable response when a replay has no full snapshot", async () => {
        const baseUrl = await startServer();
        await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report([
                replayEvent(10, { type: 3, timestamp: 1_700_000_000_010 }),
            ])),
        });

        const response = await fetch(`${baseUrl}/api/v1/replays?appId=checkout`);
        expect(await response.json()).toMatchObject({
            items: [{ replayId: "replay-1", status: "incomplete" }],
        });
    });

    it("rejects replay data that exceeds the session limits", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report(
                Array.from({ length: 1001 }, (_, index) =>
                    replayEvent(index, { type: 3, timestamp: 1_700_000_000_000 + index })),
            )),
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
            error: "replay_limit_exceeded",
        });
    });

    it("rejects a replay whose duration exceeds the session limit", async () => {
        const baseUrl = await startServer();
        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report([
                replayEvent(30 * 60 * 1000 + 1, {
                    type: 2,
                    timestamp: 1_700_000_000_000 + 30 * 60 * 1000 + 1,
                }),
            ])),
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
            error: "replay_limit_exceeded",
        });
    });
});
