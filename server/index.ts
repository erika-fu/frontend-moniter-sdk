import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import { resolveErrorStack, type StackResolutionOptions } from "./errorStack.js";
import { SQLiteReportStore } from "./store.js";

export interface ReportServerOptions {
    logger?: ((report: unknown) => void) | undefined;
    stackResolution?: StackResolutionOptions | undefined;
    store?: ReportStore | undefined;
    databasePath?: string | undefined;
}

export interface ReportStore {
    save(report: unknown): void;
    list(): unknown[];
}

export interface HealthResponse {
    status: "ok";
    apiVersion: "v1";
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

function sendBadRequest(response: ServerResponse, message: string): void {
    sendJson(response, 400, {
        error: "invalid_report",
        message,
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasReportData(value: unknown): value is Record<string, unknown> & {
    data: unknown[];
} {
    return isRecord(value) && Array.isArray(value.data);
}

function validateVersionedEnvelope(
    payload: Record<string, unknown>,
): string | undefined {
    if (
        typeof payload.sessionId !== "string" ||
        payload.sessionId.trim() === ""
    ) {
        return "sessionId is required and must be a non-empty string.";
    }
    if (
        typeof payload.timestamp !== "number" ||
        !Number.isFinite(payload.timestamp)
    ) {
        return "timestamp is required and must be a finite number.";
    }
    if (typeof payload.release !== "string") {
        return "release is required and must be a string.";
    }
    if (
        !isRecord(payload.user) ||
        typeof payload.user.id !== "string"
    ) {
        return "user.id is required and must be a string.";
    }
    if (
        !isRecord(payload.environment) ||
        typeof payload.environment.url !== "string" ||
        typeof payload.environment.userAgent !== "string" ||
        typeof payload.environment.language !== "string"
    ) {
        return "environment must include url, userAgent, and language strings.";
    }
    return undefined;
}

function normalizeReport(
    payload: unknown,
    requireVersionedEnvelope: boolean,
): { report: unknown; error?: string } {
    if (!hasReportData(payload)) {
        return {
            report: payload,
            error: "Report must be an object with a data array.",
        };
    }

    const protocolVersion = payload.protocolVersion;
    const hasVersion = protocolVersion !== undefined;
    if (hasVersion && protocolVersion !== 1) {
        return {
            report: payload,
            error: "Unsupported protocolVersion. Expected 1.",
        };
    }

    const appId = payload.appId;
    if (
        (requireVersionedEnvelope || hasVersion) &&
        (typeof appId !== "string" || appId.trim() === "")
    ) {
        return {
            report: payload,
            error: "appId is required and must be a non-empty string.",
        };
    }
    if (hasVersion) {
        const error = validateVersionedEnvelope(payload);
        if (error) {
            return { report: payload, error };
        }
    }

    // Keep the legacy shape intact for existing SDK clients and consumers.
    return { report: payload };
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
    const store = options.store ??
        (options.databasePath || process.env.REPORT_DB_PATH
            ? new SQLiteReportStore(
                  options.databasePath ??
                      process.env.REPORT_DB_PATH ??
                      "",
              )
            : new InMemoryReportStore());
    const stackResolution = options.stackResolution ?? {};

    return createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");

        if (request.method === "OPTIONS") {
            send(response, 204);
            return;
        }

        if (
            (url.pathname === "/health" ||
                url.pathname === "/api/v1/health") &&
            request.method === "GET"
        ) {
            const body: HealthResponse = { status: "ok", apiVersion: "v1" };
            sendJson(response, 200, body);
            return;
        }

        if (request.method === "GET" && store instanceof SQLiteReportStore) {
            const parseNumber = (key: string): number | undefined => {
                const value = url.searchParams.get(key);
                if (value === null || value === "") return undefined;
                const number = Number(value);
                return Number.isFinite(number) ? number : undefined;
            };
            const page = Math.max(1, Math.floor(parseNumber("page") ?? 1));
            const pageSize = Math.min(
                100,
                Math.max(1, Math.floor(parseNumber("pageSize") ?? 25)),
            );
            const query = {
                appId: url.searchParams.get("appId") ?? undefined,
                from: parseNumber("from") ?? parseNumber("startTime"),
                to: parseNumber("to") ?? parseNumber("endTime"),
                type:
                    url.searchParams.get("type") ??
                    url.searchParams.get("eventType") ??
                    undefined,
            };
            if (url.pathname === "/api/v1/apps") {
                sendJson(response, 200, store.apps());
                return;
            }
            if (
                url.pathname === "/api/v1/events" ||
                url.pathname === "/api/v1/overview" ||
                (url.pathname === "/api/v1/reports" &&
                    [...url.searchParams.keys()].length > 0)
            ) {
                const events = store.queryEvents({ ...query, page, pageSize });
                sendJson(response, 200, {
                    summary: store.summary(query),
                    events,
                });
                return;
            }
        }

        const isVersionedReportEndpoint =
            url.pathname === "/api/v1/reportData";
        const isLegacyReportEndpoint = url.pathname === "/reportData";
        if (!isVersionedReportEndpoint && !isLegacyReportEndpoint) {
            if (
                (url.pathname === "/reports" ||
                    url.pathname === "/api/v1/reports") &&
                request.method === "GET"
            ) {
                sendJson(response, 200, store.list());
                return;
            }
            send(response, 404, "Not Found");
            return;
        }

        if (request.method === "GET") {
            const data = url.searchParams.get("data");
            const payload = data === null ? null : parseJson(data);
            const normalized = normalizeReport(
                payload,
                isVersionedReportEndpoint,
            );
            if (normalized.error) {
                sendBadRequest(response, normalized.error);
                return;
            }
            const report = await resolveReportPayload(
                normalized.report,
                stackResolution,
            );
            store.save(report);
            logger(report);
            if (isVersionedReportEndpoint) {
                sendJson(response, 202, { status: "accepted" });
            } else {
                send(response, 200, "ok");
            }
            return;
        }

        if (request.method === "POST") {
            const normalized = normalizeReport(
                await readRequestBody(request),
                isVersionedReportEndpoint,
            );
            if (normalized.error) {
                sendBadRequest(response, normalized.error);
                return;
            }
            const report = await resolveReportPayload(
                normalized.report,
                stackResolution,
            );
            store.save(report);
            logger(report);
            if (isVersionedReportEndpoint) {
                sendJson(response, 202, { status: "accepted" });
            } else {
                send(response, 200, "ok");
            }
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
        databasePath:
            process.env.REPORT_DB_PATH ??
            new URL("./data/monitoring.sqlite", import.meta.url).pathname,
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
