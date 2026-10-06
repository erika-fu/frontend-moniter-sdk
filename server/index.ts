import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";
import { resolveErrorStack, type StackResolutionOptions } from "./errorStack.js";
import { isParseableSourceMap } from "./sourceMaps.js";
import { SQLiteReportStore, type SourceMapUpload } from "./store.js";
import type { ErrorStatus } from "./errorIssues.js";
import type { PerformanceMetricName } from "./performance.js";

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
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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

const SOURCE_MAP_MAX_BYTES = 5 * 1024 * 1024;

async function readBodyBuffer(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > SOURCE_MAP_MAX_BYTES) {
            throw new Error("source map exceeds the 5 MiB limit.");
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}

function multipartFields(
    body: Buffer,
    contentType: string,
): Record<string, Buffer> | undefined {
    const boundary = contentType.match(/boundary="?([^";]+)"?/i)?.[1];
    if (!boundary) return undefined;
    const delimiter = Buffer.from(`--${boundary}`);
    const fields: Record<string, Buffer> = {};
    let start = 0;
    while (true) {
        const partStart = body.indexOf(delimiter, start);
        if (partStart < 0) break;
        const contentStart = partStart + delimiter.length;
        if (body.subarray(contentStart, contentStart + 2).toString() === "--") break;
        const headerStart = contentStart + 2;
        const separator = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
        if (separator < 0) break;
        const headers = body.subarray(headerStart, separator).toString("utf8");
        const name = headers.match(/name="([^"]+)"/i)?.[1];
        if (!name) {
            start = separator + 4;
            continue;
        }
        const next = body.indexOf(delimiter, separator + 4);
        if (next < 0) break;
        const valueEnd = next - 2;
        fields[name] = body.subarray(separator + 4, valueEnd);
        start = next;
    }
    return fields;
}

async function parseSourceMapUpload(
    request: IncomingMessage,
): Promise<{ upload?: SourceMapUpload; error?: string; tooLarge?: boolean }> {
    let body: Buffer;
    try {
        body = await readBodyBuffer(request);
    } catch (error) {
        return { error: error instanceof Error ? error.message : "request is too large", tooLarge: true };
    }
    const contentType = request.headers["content-type"] ?? "";
    const fields = contentType.includes("multipart/form-data")
        ? multipartFields(body, contentType)
        : undefined;
    let appId: unknown;
    let release: unknown;
    let generatedFile: unknown;
    let sourceMap: unknown;
    let replace: unknown;
    if (fields) {
        appId = fields.appId?.toString("utf8");
        release = fields.release?.toString("utf8");
        generatedFile = fields.generatedFile?.toString("utf8") ??
            fields.fileName?.toString("utf8");
        replace = fields.replace?.toString("utf8");
        const mapText = fields.sourceMap?.toString("utf8") ??
            fields.map?.toString("utf8") ??
            fields.file?.toString("utf8");
        try {
            sourceMap = mapText === undefined ? undefined : JSON.parse(mapText);
        } catch {
            return { error: "sourceMap must be valid JSON." };
        }
    } else {
        const payload = parseJson(body.toString("utf8"));
        if (!isRecord(payload)) return { error: "request must be a JSON object or multipart form." };
        appId = payload.appId;
        release = payload.release;
        generatedFile = payload.generatedFile ?? payload.fileName;
        sourceMap = payload.sourceMap ?? payload.map ?? payload.file;
        replace = payload.replace;
        if (typeof sourceMap === "string") {
            try {
                sourceMap = JSON.parse(sourceMap);
            } catch {
                return { error: "sourceMap must be valid JSON." };
            }
        }
    }
    if (typeof appId !== "string" || appId.trim() === "") {
        return { error: "appId is required and must be a non-empty string." };
    }
    if (typeof release !== "string" || release.trim() === "") {
        return { error: "release is required and must be a non-empty string." };
    }
    if (typeof generatedFile !== "string" || generatedFile.trim() === "") {
        return { error: "generatedFile is required and must be a non-empty string." };
    }
    if (!isParseableSourceMap(sourceMap)) {
        return { error: "sourceMap must be a valid version 3 source map." };
    }
    return {
        upload: {
            appId: appId.trim(),
            release: release.trim(),
            generatedFile: generatedFile.trim(),
            sourceMap,
            replace: replace === true || replace === "true" || replace === "1",
        },
    };
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
            const pageUrl = url.searchParams.get("pageUrl") ?? undefined;
            const performanceQuery = {
                appId: query.appId,
                from: query.from,
                to: query.to,
                pageUrl,
                minDuration: parseNumber("minDuration"),
                maxDuration: parseNumber("maxDuration"),
            };
            const errorQuery = {
                ...query,
                subType: url.searchParams.get("subType") ?? undefined,
                status: (url.searchParams.get("status") ?? undefined) as ErrorStatus | undefined,
                search: url.searchParams.get("search") ??
                    url.searchParams.get("keyword") ?? undefined,
                sort: (url.searchParams.get("sort") ?? undefined) as
                    "lastSeen" | "firstSeen" | "count" | undefined,
            };
            if (url.pathname === "/api/v1/apps") {
                sendJson(response, 200, store.apps());
                return;
            }
            if (
                url.pathname === "/api/v1/performance" ||
                url.pathname === "/api/v1/performance/metrics"
            ) {
                const metricNames = (url.searchParams.get("metrics") ?? "")
                    .split(",")
                    .filter(Boolean) as PerformanceMetricName[];
                sendJson(response, 200, {
                    metrics: store.performanceMetrics({
                        ...performanceQuery,
                        metrics: metricNames.length ? metricNames : undefined,
                    }),
                });
                return;
            }
            if (url.pathname === "/api/v1/performance/requests") {
                const status = parseNumber("status");
                sendJson(response, 200, store.performanceRequests({
                    ...performanceQuery,
                    keyword: url.searchParams.get("keyword") ??
                        url.searchParams.get("search") ?? undefined,
                    status,
                    sort: (url.searchParams.get("sort") ?? undefined) as
                        "duration" | "status" | "url" | undefined,
                    order: (url.searchParams.get("order") ?? undefined) as
                        "asc" | "desc" | undefined,
                    page,
                    pageSize,
                }));
                return;
            }
            if (url.pathname === "/api/v1/performance/resources") {
                sendJson(response, 200, store.performanceResources({
                    ...performanceQuery,
                    resourceType: url.searchParams.get("resourceType") ??
                        url.searchParams.get("type") ?? undefined,
                    keyword: url.searchParams.get("keyword") ??
                        url.searchParams.get("search") ?? undefined,
                    sort: (url.searchParams.get("sort") ?? undefined) as
                        "duration" | "url" | undefined,
                    order: (url.searchParams.get("order") ?? undefined) as
                        "asc" | "desc" | undefined,
                    page,
                    pageSize,
                }));
                return;
            }
            if (url.pathname === "/api/v1/source-maps") {
                sendJson(response, 200, store.listSourceMaps(
                    url.searchParams.get("appId") ?? undefined,
                    url.searchParams.get("release") ?? undefined,
                ));
                return;
            }
            if (url.pathname === "/api/v1/errors") {
                sendJson(response, 200, store.queryErrors({
                    ...errorQuery,
                    page,
                    pageSize,
                }));
                return;
            }
            if (url.pathname.startsWith("/api/v1/errors/")) {
                const fingerprint = decodeURIComponent(
                    url.pathname.slice("/api/v1/errors/".length),
                );
                const issue = store.getError(fingerprint);
                if (!issue) {
                    send(response, 404, "Not Found");
                    return;
                }
                sendJson(response, 200, {
                    issue,
                    events: store.errorEvents(fingerprint, page, pageSize),
                });
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

        if (
            request.method === "POST" &&
            store instanceof SQLiteReportStore &&
            url.pathname === "/api/v1/source-maps"
        ) {
            const parsed = await parseSourceMapUpload(request);
            if (parsed.tooLarge) {
                sendJson(response, 413, {
                    error: "source_map_too_large",
                    message: parsed.error,
                });
                return;
            }
            if (!parsed.upload) {
                sendJson(response, 400, {
                    error: "invalid_source_map",
                    message: parsed.error,
                });
                return;
            }
            const result = store.putSourceMap(parsed.upload);
            if (result === "exists") {
                sendJson(response, 409, {
                    error: "source_map_exists",
                    message: "A Source Map already exists for this generated file. Set replace=true to replace it.",
                });
                return;
            }
            sendJson(response, 201, {
                status: result,
                appId: parsed.upload.appId,
                release: parsed.upload.release,
                generatedFile: parsed.upload.generatedFile,
            });
            return;
        }

        if (
            request.method === "PATCH" &&
            store instanceof SQLiteReportStore &&
            url.pathname.startsWith("/api/v1/errors/")
        ) {
            const fingerprint = decodeURIComponent(
                url.pathname.slice("/api/v1/errors/".length),
            );
            const body = await readRequestBody(request);
            const status = isRecord(body) ? body.status : undefined;
            if (
                status !== "unresolved" &&
                status !== "resolved" &&
                status !== "ignored"
            ) {
                sendBadRequest(response, "status must be unresolved, resolved, or ignored.");
                return;
            }
            if (!store.updateErrorStatus(fingerprint, status)) {
                send(response, 404, "Not Found");
                return;
            }
            sendJson(response, 200, { status });
            return;
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
