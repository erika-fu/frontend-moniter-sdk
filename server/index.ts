import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import { resolveErrorStack, type StackResolutionOptions } from "./errorStack.js";

export interface ReportServerOptions {
    logger?: ((report: unknown) => void) | undefined;
    stackResolution?: StackResolutionOptions | undefined;
    store?: ReportStore | undefined;
}

export interface ReportStore {
    save(report: unknown): void;
    list(): unknown[];
}

export class InMemoryReportStore implements ReportStore {
    private readonly reports: unknown[] = [];

    save(report: unknown): void {
        this.reports.unshift(report);
        this.reports.splice(100);
    }

    list(): unknown[] {
        return [...this.reports];
    }
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(body));
    }

    return parseJson(body);
}

function send(
    response: ServerResponse,
    statusCode: number,
    body = "",
): void {
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(body);
}

function sendJson(
    response: ServerResponse,
    statusCode: number,
    body: unknown,
): void {
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

async function resolveReportPayload(
    payload: unknown,
    options: StackResolutionOptions,
): Promise<unknown> {
    if (!payload || typeof payload !== "object") {
        return payload;
    }

    const candidate = payload as { data?: unknown };
    if (Array.isArray(candidate.data)) {
        return {
            ...candidate,
            data: await Promise.all(
                candidate.data.map((item) => resolveErrorStack(item, options)),
            ),
        };
    }

    return resolveErrorStack(payload, options);
}

export function createReportServer(
    options: ReportServerOptions = {},
): Server {
    const logger = options.logger ?? console.log;
    const store = options.store ?? new InMemoryReportStore();
    const stackResolution = options.stackResolution ?? {};

    return createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");

        if (request.method === "OPTIONS") {
            send(response, 204);
            return;
        }

        if (url.pathname !== "/reportData") {
            if (url.pathname === "/reports" && request.method === "GET") {
                sendJson(response, 200, store.list());
                return;
            }
            send(response, 404, "Not Found");
            return;
        }

        if (request.method === "GET") {
            const data = url.searchParams.get("data");
            const report = await resolveReportPayload(
                data === null ? null : parseJson(data),
                stackResolution,
            );
            store.save(report);
            logger(report);
            send(response, 200, "ok");
            return;
        }

        if (request.method === "POST") {
            const report = await resolveReportPayload(
                await readRequestBody(request),
                stackResolution,
            );
            store.save(report);
            logger(report);
            send(response, 200, "ok");
            return;
        }

        send(response, 405, "Method Not Allowed");
    });
}

const entryPath = process.argv[1];
if (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(entryPath).href
) {
    const port = Number.parseInt(process.env.PORT ?? "9800", 10);
    const server = createReportServer({
        stackResolution: {
            sourceMapUrl: (fileUrl) =>
                fileUrl.startsWith("http://localhost:4173/")
                    ? `${fileUrl}.map`
                    : undefined,
        },
    });

    server.listen(port, () => {
        console.log(`server is running on ${port}`);
    });
}
