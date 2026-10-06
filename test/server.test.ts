import type { AddressInfo } from "node:net";
import { unlinkSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReportServer } from "../server/index.js";

const servers: ReturnType<typeof createReportServer>[] = [];

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            (server) =>
                new Promise<void>((resolve, reject) => {
                    server.close((error) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve();
                    });
                }),
        ),
    );
});

async function startServer(
    logger = vi.fn(),
    options: Parameters<typeof createReportServer>[0] = {},
): Promise<{
    baseUrl: string;
    logger: typeof logger;
    server: ReturnType<typeof createReportServer>;
}> {
    const server = createReportServer({ ...options, logger });
    servers.push(server);

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        logger,
        server,
    };
}

async function stopServer(
    server: ReturnType<typeof createReportServer>,
): Promise<void> {
    servers.splice(servers.indexOf(server), 1);
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

describe("report server", () => {
    function sourceMap() {
        return {
            version: 3,
            file: "app.js",
            sourceRoot: "",
            sources: ["src/demo.ts"],
            names: [],
            mappings: "AAAA",
        };
    }

    async function uploadMap(
        baseUrl: string,
        values: Record<string, unknown>,
    ): Promise<Response> {
        return fetch(`${baseUrl}/api/v1/source-maps`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(values),
        });
    }

    async function ingestStack(
        baseUrl: string,
        id: string,
        release: string,
        file = "app.js",
    ): Promise<void> {
        await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                protocolVersion: 1,
                id,
                appId: "maps-app",
                projectName: "Maps",
                sessionId: id,
                timestamp: Date.now(),
                release,
                user: { id: "user" },
                environment: {
                    url: "/",
                    userAgent: "test",
                    language: "zh-CN",
                },
                data: [{
                    type: "error",
                    subType: "js",
                    msg: id,
                    stack: `Error: ${id}\n    at render (http://cdn.test/${file}:1:1)`,
                }],
            }),
        });
    }

    it("exposes the versioned health boundary", async () => {
        const { baseUrl } = await startServer();

        const response = await fetch(`${baseUrl}/api/v1/health`);

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            status: "ok",
            apiVersion: "v1",
        });
    });

    it("accepts a versioned envelope with a stable app id", async () => {
        const { baseUrl, logger } = await startServer();
        const report = {
            protocolVersion: 1,
            id: "id-v1",
            projectName: "demo",
            appId: "demo-web",
            sessionId: "session-1",
            timestamp: Date.now(),
            release: "demo@1.0.0",
            userId: "user-1",
            user: { id: "user-1" },
            environment: {
                url: "https://demo.example",
                userAgent: "test",
                language: "zh-CN",
            },
            data: [{ type: "error", message: "boom" }],
        };

        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report),
        });

        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ status: "accepted" });
        expect(logger).toHaveBeenCalledWith(report);
    });

    it("rejects malformed versioned reports with a client error", async () => {
        const { baseUrl, logger } = await startServer();

        const response = await fetch(`${baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                protocolVersion: 1,
                data: [],
            }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: "invalid_report",
            message: "appId is required and must be a non-empty string.",
        });
        expect(logger).not.toHaveBeenCalled();
    });

    it("accepts a JSON report from the SDK", async () => {
        const { baseUrl, logger } = await startServer();
        const report = {
            id: "id-1",
            data: [{ type: "error", message: "boom" }],
        };

        const response = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
            },
            body: JSON.stringify(report),
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect(logger).toHaveBeenCalledWith(report);
    });

    it("parses the text body sent by sendBeacon", async () => {
        const { baseUrl, logger } = await startServer();
        const report = {
            id: "id-beacon",
            data: [{ type: "behavior", subType: "click" }],
        };

        const response = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: {
                "content-type": "text/plain;charset=UTF-8",
            },
            body: JSON.stringify(report),
        });

        expect(response.status).toBe(200);
        expect(logger).toHaveBeenCalledWith(report);
    });

    it("accepts an image report from the SDK query string", async () => {
        const { baseUrl, logger } = await startServer();
        const report = {
            id: "id-2",
            data: [{ type: "performance", subType: "LCP" }],
        };
        const query = new URLSearchParams({
            data: JSON.stringify(report),
        });

        const response = await fetch(`${baseUrl}/reportData?${query}`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
        expect(logger).toHaveBeenCalledWith(report);
    });

    it("parses stacks and stores SourceMap-resolved frames", async () => {
        const { baseUrl, logger } = await startServer(vi.fn(), {
            stackResolution: {
                sourceMapUrl: (fileUrl, release) => {
                    expect(fileUrl).toBe("http://127.0.0.1/app.js");
                    expect(release).toBe("demo@1.0.0");
                    return "http://maps.example/app.js.map";
                },
            },
        });
        const sourceMapResponse = {
            version: 3,
            sources: ["src/demo.ts"],
            names: [],
            mappings: "AAAA",
        };
        const nativeFetch = globalThis.fetch;
        const fetchMock = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify(sourceMapResponse), {
                status: 200,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const report = {
            id: "id-stack",
            data: [
                {
                    type: "error",
                    subType: "js",
                    msg: "boom",
                    url: "http://127.0.0.1/app.js",
                    lineNo: 1,
                    columnNo: 1,
                    stack: "Error: boom\n    at demo (http://127.0.0.1/app.js:1:1)",
                    release: "demo@1.0.0",
                },
            ],
        };

        await nativeFetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report),
        });

        const saved = logger.mock.calls[0]?.[0] as {
            data: [{ stackFrames: unknown[]; sourceStack: unknown[] }];
        };
        expect(saved.data[0].stackFrames).toHaveLength(1);
        expect(saved.data[0].sourceStack[0]).toMatchObject({
            originalFileName: "http://maps.example/src/demo.ts",
            originalLineNumber: 1,
            originalColumnNumber: 1,
        });

        const reportsResponse = await nativeFetch(`${baseUrl}/reports`);
        expect(await reportsResponse.json()).toMatchObject([{
            id: "id-stack",
            data: [{
                stack: "Error: boom\n    at demo (http://127.0.0.1/app.js:1:1)",
            }],
        }]);
        vi.unstubAllGlobals();
    });

    it("handles browser CORS preflight requests", async () => {
        const { baseUrl, logger } = await startServer();

        const response = await fetch(`${baseUrl}/reportData`, {
            method: "OPTIONS",
            headers: {
                origin: "https://example.com",
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-methods")).toContain(
            "POST",
        );
        expect(response.headers.get("access-control-allow-headers")).toBe(
            "Content-Type",
        );
        expect(logger).not.toHaveBeenCalled();
    });

    it("stores Source Maps by app and release and resolves error details", async () => {
        const databasePath = `/tmp/monitoring-maps-${Date.now()}-${Math.random()}.sqlite`;
        const { baseUrl } = await startServer(vi.fn(), { databasePath });
        const upload = await uploadMap(baseUrl, {
            appId: "maps-app",
            release: "1.0.0",
            generatedFile: "app.js",
            sourceMap: {
                ...sourceMap(),
                sourcesContent: ["throw new Error('mapped');\nreturn 1;"],
            },
        });
        expect(upload.status).toBe(201);
        expect(await upload.json()).toMatchObject({ status: "created" });

        await ingestStack(baseUrl, "mapped", "1.0.0");
        const errors = await fetch(`${baseUrl}/api/v1/errors?appId=maps-app`);
        const issue = (await errors.json()).items[0];
        expect(issue).toMatchObject({
            resolutionStatus: "resolved",
            stackFrames: [{
                originalFileName: "src/demo.ts",
                originalLineNumber: 1,
                originalColumnNumber: 1,
                sourceContext: [
                    { lineNumber: 1, content: "throw new Error('mapped');" },
                    { lineNumber: 2, content: "return 1;" },
                ],
            }],
            rawStack: expect.stringContaining("http://cdn.test/app.js"),
        });
        expect(issue.rawStack).toContain("Error: mapped");
        expect(issue.stack).toContain("render@http://cdn.test/app.js@1@1");
        const details = await (await fetch(
            `${baseUrl}/api/v1/errors/${issue.fingerprint}`,
        )).json();
        expect(details.issue.resolutionStatus).toBe("resolved");
    });

    it("isolates releases, supports replacement, and exposes stable resolution failures", async () => {
        const databasePath = `/tmp/monitoring-map-status-${Date.now()}-${Math.random()}.sqlite`;
        const { baseUrl } = await startServer(vi.fn(), { databasePath });
        const first = await uploadMap(baseUrl, {
            appId: "maps-app",
            release: "1.0.0",
            generatedFile: "app.js",
            sourceMap: sourceMap(),
        });
        expect(first.status).toBe(201);
        expect((await uploadMap(baseUrl, {
            appId: "maps-app",
            release: "1.0.0",
            generatedFile: "app.js",
            sourceMap: sourceMap(),
        })).status).toBe(409);
        expect((await uploadMap(baseUrl, {
            appId: "maps-app",
            release: "1.0.0",
            generatedFile: "app.js",
            sourceMap: { ...sourceMap(), sources: ["src/replaced.ts"] },
            replace: true,
        })).status).toBe(201);
        expect((await (await fetch(
            `${baseUrl}/api/v1/source-maps?appId=maps-app&release=1.0.0`,
        )).json())).toEqual([{
            appId: "maps-app",
            release: "1.0.0",
            generatedFile: "app.js",
        }]);

        await ingestStack(baseUrl, "missing-version", "2.0.0");
        await ingestStack(baseUrl, "missing-file", "1.0.0", "other.js");
        const badMap = await uploadMap(baseUrl, {
            appId: "maps-app",
            release: "3.0.0",
            generatedFile: "app.js",
            sourceMap: { ...sourceMap(), mappings: "!" },
        });
        expect(badMap.status).toBe(400);

        const result = await (await fetch(
            `${baseUrl}/api/v1/errors?appId=maps-app&pageSize=10`,
        )).json();
        const statuses = new Map(
            result.items.map((item: { message: string; resolutionStatus: string }) =>
                [item.message, item.resolutionStatus],
            ),
        );
        expect(statuses).toEqual(new Map([
            ["missing-version", "version_not_found"],
            ["missing-file", "file_not_found"],
        ]));
    });

    it("keeps HTTP-ingested history queryable after a server restart", async () => {
        const databasePath = `/tmp/monitoring-http-${Date.now()}-${Math.random()}.sqlite`;
        const first = await startServer(vi.fn(), { databasePath });
        const report = {
            protocolVersion: 1,
            id: "restart-id",
            appId: "restart-app",
            projectName: "Restart project",
            sessionId: "session",
            timestamp: 1000,
            release: "1.0.0",
            user: { id: "user" },
            environment: { url: "/restart", userAgent: "test", language: "zh-CN" },
            data: [{ type: "error", subType: "js", message: "persisted" }],
        };

        const ingest = await fetch(`${first.baseUrl}/api/v1/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(report),
        });
        expect(ingest.status).toBe(202);
        await stopServer(first.server);

        const second = await startServer(vi.fn(), { databasePath });
        const query = await fetch(
            `${second.baseUrl}/api/v1/overview?appId=restart-app`,
        );
        expect(query.status).toBe(200);
        expect(await query.json()).toMatchObject({
            summary: { total: 1, byType: [{ type: "error", count: 1 }] },
            events: { total: 1 },
        });
        await stopServer(second.server);
        unlinkSync(databasePath);
    });

    it("returns not found outside the report endpoint", async () => {
        const { baseUrl } = await startServer();

        const response = await fetch(`${baseUrl}/unknown`);

        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Not Found");
    });

    it("only exposes configured origins and redacts sensitive logs", async () => {
        const { baseUrl, logger } = await startServer(vi.fn(), {
            corsOrigins: ["http://allowed.test"],
        });
        const report = {
            id: "sensitive",
            appId: "secure-app",
            data: [{
                type: "error",
                password: "do-not-log",
                token: "do-not-log",
                stack: "Error: internal details",
            }],
        };

        const denied = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: {
                origin: "http://denied.test",
                "content-type": "application/json",
            },
            body: JSON.stringify(report),
        });
        expect(denied.headers.get("access-control-allow-origin")).toBeNull();

        const allowed = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: {
                origin: "http://allowed.test",
                "content-type": "application/json",
            },
            body: JSON.stringify(report),
        });
        expect(allowed.headers.get("access-control-allow-origin")).toBe(
            "http://allowed.test",
        );
        expect(logger).toHaveBeenLastCalledWith(expect.objectContaining({
            ...report,
            data: [expect.objectContaining({
                type: "error",
                password: "[redacted]",
                token: "[redacted]",
                stack: "[redacted]",
            })],
        }));
    });

    it("enforces the configured report body limit", async () => {
        const { baseUrl } = await startServer(vi.fn(), { reportMaxBytes: 32 });

        const response = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "too-large", data: ["payload"] }),
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({
            error: "request_too_large",
        });
    });

    it("returns a generic error when storage fails", async () => {
        const { baseUrl } = await startServer(vi.fn(), {
            store: {
                save: () => {
                    throw new Error("database password and stack details");
                },
                list: () => [],
            },
        });

        const response = await fetch(`${baseUrl}/reportData`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: "storage-error", data: [] }),
        });

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            error: "internal_server_error",
            message: "The monitoring service could not process the request.",
        });
    });
});
