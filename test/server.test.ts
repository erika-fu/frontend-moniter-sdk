import type { AddressInfo } from "node:net";
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
): Promise<{ baseUrl: string; logger: typeof logger }> {
    const server = createReportServer({ ...options, logger });
    servers.push(server);

    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        logger,
    };
}

describe("report server", () => {
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
        expect(await reportsResponse.json()).toEqual([saved]);
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

    it("returns not found outside the report endpoint", async () => {
        const { baseUrl } = await startServer();

        const response = await fetch(`${baseUrl}/unknown`);

        expect(response.status).toBe(404);
        expect(await response.text()).toBe("Not Found");
    });
});
