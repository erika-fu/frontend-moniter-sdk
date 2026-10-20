import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveErrorStack, type StackResolutionOptions } from "./errorStack.js";
import { isParseableSourceMap } from "./sourceMaps.js";
import {
    DEFAULT_RETENTION_DAYS,
    SQLiteReportStore,
    type SourceMapUpload,
} from "./store.js";
import { demoSourceMapUrl, tryServeStatic } from "./static.js";
import type { ErrorStatus } from "./errorIssues.js";
import type {
    PerformanceMetricName,
    ViewPaintMetricName,
} from "./performance.js";

export interface ReportServerOptions {
    logger?: ((report: unknown) => void) | undefined;
    stackResolution?: StackResolutionOptions | undefined;
    store?: ReportStore | undefined;
    databasePath?: string | undefined;
    corsOrigins?: string[] | undefined;
    reportMaxBytes?: number | undefined;
    sourceMapMaxBytes?: number | undefined;
    /** Directory containing `demo/` and `platform/` build output. */
    staticRoot?: string | undefined;
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

const DEFAULT_CORS_ORIGINS = "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};
const REPORT_MAX_BYTES = 1 * 1024 * 1024;

class RequestBodyLimitError extends Error {}

function configuredOrigins(options: ReportServerOptions): string[] {
    const value = options.corsOrigins ??
        (process.env.CORS_ORIGINS ?? DEFAULT_CORS_ORIGINS)
            .split(",")
            .map((origin) => origin.trim())
            .filter(Boolean);
    return value.length ? value : [DEFAULT_CORS_ORIGINS];
}

function corsHeaders(
    request: IncomingMessage,
    origins: string[],
): Record<string, string> {
    const origin = request.headers.origin;
    const allowed = origins.includes("*")
        ? "*"
        : origin && origins.includes(origin)
            ? origin
            : undefined;
    return {
        ...CORS_HEADERS,
        ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
        ...(allowed && allowed !== "*" ? { Vary: "Origin" } : {}),
    };
}

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

const SENSITIVE_KEYS = new Set([
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
    "accessToken",
    "refreshToken",
]);

function redactForLog(value: unknown, key?: string): unknown {
    if (key === "stack" || key === "rawStack") return "[redacted]";
    if (key && SENSITIVE_KEYS.has(key)) return "[redacted]";
    if (Array.isArray(value)) return value.map((item) => redactForLog(item));
    if (!isRecord(value)) return value;
    return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            redactForLog(entryValue, entryKey),
        ]),
    );
}

async function readRequestBody(
    request: IncomingMessage,
    maxBytes = REPORT_MAX_BYTES,
): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
            throw new RequestBodyLimitError(
                `request body exceeds the ${maxBytes} byte limit.`,
            );
        }
        chunks.push(buffer);
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(body));
    }

    return parseJson(body);
}

const SOURCE_MAP_MAX_BYTES = 5 * 1024 * 1024;

async function readBodyBuffer(
    request: IncomingMessage,
    maxBytes = SOURCE_MAP_MAX_BYTES,
): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > maxBytes) {
            throw new Error(`request body exceeds the ${maxBytes} byte limit.`);
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
    maxBytes = SOURCE_MAP_MAX_BYTES,
): Promise<{ upload?: SourceMapUpload; error?: string; tooLarge?: boolean }> {
    let body: Buffer;
    try {
        body = await readBodyBuffer(request, maxBytes);
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
    headers: Record<string, string> = {},
): void {
    response.writeHead(statusCode, {
        ...headers,
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(body);
}

function sendJson(
    response: ServerResponse,
    statusCode: number,
    body: unknown,
    headers: Record<string, string> = {},
): void {
    response.writeHead(statusCode, {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(body));
}

function sendBadRequest(
    response: ServerResponse,
    message: string,
    headers: Record<string, string>,
): void {
    sendJson(response, 400, {
        error: "invalid_report",
        message,
    }, headers);
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
    const origins = configuredOrigins(options);
    const reportMaxBytes = options.reportMaxBytes ?? REPORT_MAX_BYTES;
    const sourceMapMaxBytes = options.sourceMapMaxBytes ?? SOURCE_MAP_MAX_BYTES;
    const staticRoot = options.staticRoot ??
        (process.env.STATIC_ROOT
            ? resolve(process.env.STATIC_ROOT)
            : undefined);

    return createServer((request, response) => {
        void (async () => {
            const url = new URL(request.url ?? "/", "http://localhost");
            const headers = corsHeaders(request, origins);

        if (request.method === "OPTIONS") {
            send(response, 204, "", headers);
            return;
        }

        if (
            (url.pathname === "/health" ||
                url.pathname === "/api/v1/health") &&
            request.method === "GET"
        ) {
            const body: HealthResponse = { status: "ok", apiVersion: "v1" };
            sendJson(response, 200, body, headers);
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
                sendJson(response, 200, store.apps(), headers);
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
                }, headers);
                return;
            }
            if (url.pathname === "/api/v1/performance/view-paint") {
                const metricNames = (url.searchParams.get("metrics") ?? "")
                    .split(",")
                    .filter(Boolean) as ViewPaintMetricName[];
                sendJson(response, 200, {
                    metrics: store.viewPaintMetrics({
                        ...performanceQuery,
                        metrics: metricNames.length ? metricNames : undefined,
                    }),
                }, headers);
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
                }), headers);
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
                }), headers);
                return;
            }
            if (url.pathname === "/api/v1/source-maps") {
                sendJson(response, 200, store.listSourceMaps(
                    url.searchParams.get("appId") ?? undefined,
                    url.searchParams.get("release") ?? undefined,
                ), headers);
                return;
            }
            if (url.pathname === "/api/v1/errors") {
                sendJson(response, 200, store.queryErrors({
                    ...errorQuery,
                    page,
                    pageSize,
                }), headers);
                return;
            }
            if (url.pathname === "/api/v1/replays") {
                sendJson(response, 200, store.queryReplays({
                    appId: query.appId,
                    replayId: url.searchParams.get("replayId") ?? undefined,
                    userId: url.searchParams.get("userId") ?? undefined,
                    from: query.from,
                    to: query.to,
                    page,
                    pageSize,
                }), headers);
                return;
            }
            if (url.pathname.startsWith("/api/v1/replays/")) {
                const replayId = decodeURIComponent(
                    url.pathname.slice("/api/v1/replays/".length),
                );
                const replay = store.getReplay(replayId, query.appId);
                if (!replay) {
                    sendJson(response, 404, {
                        error: "replay_not_found",
                        message: "Replay session was not found.",
                    }, headers);
                    return;
                }
                sendJson(response, 200, replay, headers);
                return;
            }
            if (url.pathname.startsWith("/api/v1/errors/")) {
                const fingerprint = decodeURIComponent(
                    url.pathname.slice("/api/v1/errors/".length),
                );
                const issue = store.getError(fingerprint);
                if (!issue) {
                    send(response, 404, "Not Found", headers);
                    return;
                }
                sendJson(response, 200, {
                    issue,
                    events: store.errorEvents(fingerprint, page, pageSize),
                }, headers);
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
                }, headers);
                return;
            }
        }

        if (
            request.method === "POST" &&
            store instanceof SQLiteReportStore &&
            url.pathname === "/api/v1/source-maps"
        ) {
            const parsed = await parseSourceMapUpload(request, sourceMapMaxBytes);
            if (parsed.tooLarge) {
                sendJson(response, 413, {
                    error: "source_map_too_large",
                    message: parsed.error,
                }, headers);
                return;
            }
            if (!parsed.upload) {
                sendJson(response, 400, {
                    error: "invalid_source_map",
                    message: parsed.error,
                }, headers);
                return;
            }
            const result = store.putSourceMap(parsed.upload);
            if (result === "exists") {
                sendJson(response, 409, {
                    error: "source_map_exists",
                    message: "A Source Map already exists for this generated file. Set replace=true to replace it.",
                }, headers);
                return;
            }
            sendJson(response, 201, {
                status: result,
                appId: parsed.upload.appId,
                release: parsed.upload.release,
                generatedFile: parsed.upload.generatedFile,
            }, headers);
            return;
        }

        if (
            request.method === "DELETE" &&
            store instanceof SQLiteReportStore &&
            url.pathname === "/api/v1/records"
        ) {
            const result = store.clearAll();
            sendJson(response, 200, { status: "cleared", ...result }, headers);
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
                sendJson(response, 400, {
                    error: "invalid_report",
                    message: "status must be unresolved, resolved, or ignored.",
                }, headers);
                return;
            }
            if (!store.updateErrorStatus(fingerprint, status)) {
                send(response, 404, "Not Found", headers);
                return;
            }
            sendJson(response, 200, { status }, headers);
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
                sendJson(response, 200, store.list(), headers);
                return;
            }
            if (
                staticRoot &&
                !url.pathname.startsWith("/api") &&
                tryServeStatic(
                    request,
                    response,
                    staticRoot,
                    url.pathname,
                    headers,
                )
            ) {
                return;
            }
            send(response, 404, "Not Found", headers);
            return;
        }

        if (request.method === "GET") {
            const data = url.searchParams.get("data");
            if (
                data !== null &&
                Buffer.byteLength(data, "utf8") > reportMaxBytes
            ) {
                sendJson(response, 413, {
                    error: "request_too_large",
                    message: `request body exceeds the ${reportMaxBytes} byte limit.`,
                }, headers);
                return;
            }
            const payload = data === null ? null : parseJson(data);
            const normalized = normalizeReport(
                payload,
                isVersionedReportEndpoint,
            );
            if (normalized.error) {
                sendBadRequest(response, normalized.error, headers);
                return;
            }
            const report = await resolveReportPayload(
                normalized.report,
                stackResolution,
            );
            store.save(report);
            logger(redactForLog(report));
            if (isVersionedReportEndpoint) {
                sendJson(response, 202, { status: "accepted" }, headers);
            } else {
                send(response, 200, "ok", headers);
            }
            return;
        }

        if (request.method === "POST") {
            let body: unknown;
            try {
                body = await readRequestBody(request, reportMaxBytes);
            } catch (error) {
                if (error instanceof RequestBodyLimitError) {
                    sendJson(response, 413, {
                        error: "request_too_large",
                        message: error.message,
                    }, headers);
                    return;
                }
                throw error;
            }
            const normalized = normalizeReport(body, isVersionedReportEndpoint);
            if (normalized.error) {
                sendBadRequest(response, normalized.error, headers);
                return;
            }
            const report = await resolveReportPayload(
                normalized.report,
                stackResolution,
            );
            try {
                if (store instanceof SQLiteReportStore) {
                    const replayLimit = store.validateReplayReport(report);
                    if (replayLimit) {
                        sendJson(response, 413, {
                            error: "replay_limit_exceeded",
                            message: replayLimit,
                        });
                        return;
                    }
                }
                store.save(report);
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message.includes("Replay")
                ) {
                    sendJson(response, 413, {
                        error: "replay_limit_exceeded",
                        message: error.message,
                    });
                    return;
                }
                throw error;
            }
            logger(redactForLog(report));
            if (isVersionedReportEndpoint) {
                sendJson(response, 202, { status: "accepted" }, headers);
            } else {
                send(response, 200, "ok", headers);
            }
            return;
        }

            send(response, 405, "Method Not Allowed", headers);
        })().catch(() => {
            if (!response.headersSent) {
                sendJson(response, 500, {
                    error: "internal_server_error",
                    message: "The monitoring service could not process the request.",
                }, corsHeaders(request, origins));
            }
        });
    });
}

const entryPath = process.argv[1];
if (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(entryPath).href
) {
    const port = Number.parseInt(process.env.PORT ?? "9800", 10);
    const databasePath =
        process.env.REPORT_DB_PATH ??
        fileURLToPath(new URL("./data/monitoring.sqlite", import.meta.url));
    const retentionDays = Number.parseInt(
        process.env.RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
        10,
    );
    const store = new SQLiteReportStore(databasePath);
    const staticRoot = process.env.STATIC_ROOT
        ? resolve(process.env.STATIC_ROOT)
        : undefined;
    const cleanup = () => {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        store.cleanupBefore(cutoff);
    };
    cleanup();
    const cleanupTimer = setInterval(cleanup, 24 * 60 * 60 * 1000);
    cleanupTimer.unref();
    const server = createReportServer({
        store,
        staticRoot,
        stackResolution: {
            sourceMapUrl: (fileUrl) => demoSourceMapUrl(fileUrl),
        },
    });

    server.listen(port, () => {
        console.log(`server is running on ${port}`);
    });
}
