import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isSourceMap, resolveStack, type SourceMapRecord, type SourceMapResolutionStatus } from "./sourceMaps.js";
import {
    getErrorIdentity,
    type ErrorStatus,
} from "./errorIssues.js";
import {
    summarizeMetrics,
    summarizeViewPaintMetrics,
    type PerformanceEventRow,
    type PerformanceFilter,
    type PerformanceListResult,
    type PerformanceMetricQuery,
    type PerformanceMetricPoint,
    type PerformanceRequest,
    type RequestQuery,
    type PerformanceResource,
    type ResourceQuery,
    type ViewPaintMetricQuery,
    type ViewPaintMetricPoint,
} from "./performance.js";

export interface StoredEvent {
    id: number;
    envelopeId: string;
    appId: string;
    projectName: string;
    sessionId: string;
    timestamp: number;
    release: string;
    userId: string;
    pageUrl: string;
    type: string;
    subType: string;
    data: unknown;
    raw: unknown;
}

export interface EventQuery {
    appId?: string | undefined;
    from?: number | undefined;
    to?: number | undefined;
    type?: string | undefined;
    page: number;
    pageSize: number;
}

export interface EventQueryResult {
    items: StoredEvent[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ErrorIssue {
    fingerprint: string;
    appId: string;
    subType: string;
    message: string;
    stack: string;
    status: ErrorStatus;
    firstSeen: number;
    lastSeen: number;
    count: number;
    userCount: number;
    pages: string[];
    releases: string[];
    rawStack: string;
    stackFrames: Array<Record<string, unknown>>;
    resolutionStatus: SourceMapResolutionStatus;
}

export interface ErrorIssueQuery {
    appId?: string | undefined;
    from?: number | undefined;
    to?: number | undefined;
    subType?: string | undefined;
    status?: ErrorStatus | undefined;
    search?: string | undefined;
    sort?: "lastSeen" | "firstSeen" | "count" | undefined;
    page: number;
    pageSize: number;
}

export interface ErrorIssueQueryResult {
    items: ErrorIssue[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ReplaySession {
    appId: string;
    projectName: string;
    replayId: string;
    sessionId: string;
    userId: string;
    pageUrl: string;
    startedAt: number;
    lastSeen: number;
    duration: number;
    eventCount: number;
    errorCount: number;
    status: "ready" | "incomplete" | "unplayable";
}

export interface ReplayEvent {
    timestamp: number;
    replayOffset: number;
    event: Record<string, unknown>;
    isCheckout: boolean;
}

export interface ReplayQuery {
    appId?: string | undefined;
    replayId?: string | undefined;
    userId?: string | undefined;
    from?: number | undefined;
    to?: number | undefined;
    page: number;
    pageSize: number;
}

export interface ReplayListResult {
    items: ReplaySession[];
    total: number;
    page: number;
    pageSize: number;
}

export interface ReplayDetail {
    session: ReplaySession;
    events: ReplayEvent[];
}

interface EnvelopeRecord {
    id?: string;
    protocolVersion?: number;
    appId?: string;
    projectName?: string;
    sessionId?: string;
    timestamp?: number;
    release?: string;
    userId?: string;
    user?: { id?: string };
    environment?: { url?: string };
    data: unknown[];
}

function json(value: unknown): string {
    return JSON.stringify(value);
}

function parse<T>(value: string): T {
    return JSON.parse(value) as T;
}

export interface SourceMapUpload {
    appId: string;
    release: string;
    generatedFile: string;
    sourceMap: unknown;
    replace?: boolean | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
}

const MAX_REPLAY_EVENTS = 1000;
const MAX_REPLAY_DURATION = 30 * 60 * 1000;
const MAX_REPLAY_BYTES = 5 * 1024 * 1024;
export const DEFAULT_RETENTION_DAYS = 30;

function replayData(value: unknown): {
    replayId: string;
    sessionId: string;
    replayOffset: number;
    event: Record<string, unknown>;
    isCheckout: boolean;
} | undefined {
    const data = asRecord(value);
    const event = data.event;
    if (
        data.type !== "replay" ||
        data.subType !== "event" ||
        typeof data.replayId !== "string" ||
        typeof data.sessionId !== "string" ||
        typeof data.replayOffset !== "number" ||
        !Number.isFinite(data.replayOffset) ||
        typeof event !== "object" ||
        event === null ||
        Array.isArray(event) ||
        typeof (event as Record<string, unknown>).timestamp !== "number" ||
        !Number.isFinite((event as Record<string, unknown>).timestamp)
    ) {
        return undefined;
    }
    return {
        replayId: data.replayId,
        sessionId: data.sessionId,
        replayOffset: data.replayOffset,
        event: event as Record<string, unknown>,
        isCheckout: data.isCheckout === true,
    };
}

function errorFilter(query: Omit<ErrorIssueQuery, "page" | "pageSize">): {
    where: string;
    parameters: Array<string | number>;
} {
    const conditions = ["1 = 1"];
    const parameters: Array<string | number> = [];
    if (query.appId) {
        conditions.push("i.app_id = ?");
        parameters.push(query.appId);
    }
    if (query.subType) {
        conditions.push("i.sub_type = ?");
        parameters.push(query.subType);
    }
    if (query.status) {
        conditions.push("i.status = ?");
        parameters.push(query.status);
    }
    if (query.search) {
        conditions.push("(i.message LIKE ? OR i.stack LIKE ?)");
        const search = `%${query.search}%`;
        parameters.push(search, search);
    }
    if (query.from !== undefined) {
        conditions.push("i.last_seen >= ?");
        parameters.push(query.from);
    }
    if (query.to !== undefined) {
        conditions.push("i.first_seen <= ?");
        parameters.push(query.to);
    }
    return { where: conditions.join(" AND "), parameters };
}

function issueFromRow(row: Record<string, unknown>): ErrorIssue {
    return {
        fingerprint: String(row.fingerprint),
        appId: String(row.appId),
        subType: String(row.subType),
        message: String(row.message),
        stack: String(row.stack),
        status: row.status as ErrorStatus,
        firstSeen: Number(row.firstSeen),
        lastSeen: Number(row.lastSeen),
        count: Number(row.count),
        userCount: Number(row.userCount),
        pages: parse<string[]>(String(row.pages)),
        releases: parse<string[]>(String(row.releases)),
        rawStack: String(row.rawStack),
        stackFrames: parse<Array<Record<string, unknown>>>(String(row.stackFrames)),
        resolutionStatus: row.resolutionStatus as SourceMapResolutionStatus,
    };
}

function eventFilter(query: Omit<EventQuery, "page" | "pageSize">): {
    where: string;
    parameters: Array<string | number>;
} {
    const conditions = ["1 = 1"];
    const parameters: Array<string | number> = [];
    if (query.appId) {
        conditions.push("app_id = ?");
        parameters.push(query.appId);
    }
    if (query.from !== undefined) {
        conditions.push("timestamp >= ?");
        parameters.push(query.from);
    }
    if (query.to !== undefined) {
        conditions.push("timestamp <= ?");
        parameters.push(query.to);
    }
    if (query.type) {
        conditions.push("(type = ? OR sub_type = ?)");
        parameters.push(query.type, query.type);
    }
    return { where: conditions.join(" AND "), parameters };
}

export class SQLiteReportStore {
    private readonly database: Database.Database;

    constructor(databasePath: string) {
        mkdirSync(dirname(databasePath), { recursive: true });
        this.database = new Database(databasePath);
        this.database.pragma("journal_mode = WAL");
        this.database.exec(`
            CREATE TABLE IF NOT EXISTS envelopes (
                envelope_id TEXT PRIMARY KEY,
                app_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                release TEXT NOT NULL,
                user_id TEXT NOT NULL,
                raw_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                envelope_id TEXT NOT NULL REFERENCES envelopes(envelope_id),
                app_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                session_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                release TEXT NOT NULL,
                user_id TEXT NOT NULL,
                page_url TEXT NOT NULL,
                type TEXT NOT NULL,
                sub_type TEXT NOT NULL,
                data_json TEXT NOT NULL,
                raw_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS events_app_time
                ON events(app_id, timestamp DESC, id DESC);
            CREATE INDEX IF NOT EXISTS events_type
                ON events(app_id, type, timestamp DESC, id DESC);
            CREATE TABLE IF NOT EXISTS error_issues (
                fingerprint TEXT PRIMARY KEY,
                app_id TEXT NOT NULL,
                sub_type TEXT NOT NULL,
                message TEXT NOT NULL,
                stack TEXT NOT NULL,
                raw_stack TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'unresolved',
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS error_occurrences (
                event_id INTEGER PRIMARY KEY REFERENCES events(id),
                fingerprint TEXT NOT NULL REFERENCES error_issues(fingerprint),
                user_id TEXT NOT NULL,
                page_url TEXT NOT NULL,
                release TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS error_issues_app_time
                ON error_issues(app_id, last_seen DESC);
            CREATE INDEX IF NOT EXISTS error_occurrences_issue
                ON error_occurrences(fingerprint, event_id DESC);
            CREATE TABLE IF NOT EXISTS source_maps (
                app_id TEXT NOT NULL,
                release TEXT NOT NULL,
                generated_file TEXT NOT NULL,
                source_map_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (app_id, release, generated_file)
            );
            CREATE TABLE IF NOT EXISTS replay_sessions (
                app_id TEXT NOT NULL,
                replay_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                project_name TEXT NOT NULL,
                user_id TEXT NOT NULL,
                page_url TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                last_seen INTEGER NOT NULL,
                duration INTEGER NOT NULL DEFAULT 0,
                event_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                stored_bytes INTEGER NOT NULL DEFAULT 0,
                has_snapshot INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (app_id, replay_id)
            );
            CREATE TABLE IF NOT EXISTS replay_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_id TEXT NOT NULL,
                replay_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                replay_offset REAL NOT NULL,
                event_json TEXT NOT NULL,
                is_checkout INTEGER NOT NULL DEFAULT 0,
                UNIQUE (app_id, replay_id, timestamp, replay_offset, event_json),
                FOREIGN KEY (app_id, replay_id)
                    REFERENCES replay_sessions(app_id, replay_id)
            );
            CREATE INDEX IF NOT EXISTS replay_sessions_app_time
                ON replay_sessions(app_id, last_seen DESC, replay_id ASC);
            CREATE INDEX IF NOT EXISTS replay_events_session
                ON replay_events(app_id, replay_id, replay_offset ASC, id ASC);
        `);
        try {
            this.database.exec(
                "ALTER TABLE error_issues ADD COLUMN raw_stack TEXT NOT NULL DEFAULT ''",
            );
        } catch {
            // Existing databases already have the column.
        }
    }

    validateReplayReport(report: unknown): string | undefined {
        const envelope = asRecord(report);
        const events = Array.isArray(envelope.data) ? envelope.data : [];
        const grouped = new Map<string, ReturnType<typeof replayData>[]>();
        for (const item of events) {
            const replay = replayData(item);
            if (!replay) continue;
            const values = grouped.get(replay.replayId) ?? [];
            values.push(replay);
            grouped.set(replay.replayId, values);
        }
        for (const [replayId, incoming] of grouped) {
            const existing = this.database.prepare(`
                SELECT event_count AS eventCount, duration, stored_bytes AS storedBytes
                FROM replay_sessions WHERE app_id = ? AND replay_id = ?
            `).get(
                String(envelope.appId ?? "legacy"),
                replayId,
            ) as { eventCount: number; duration: number; storedBytes: number } | undefined;
            const eventCount = (existing?.eventCount ?? 0) + incoming.length;
            const maxOffset = Math.max(
                existing?.duration ?? 0,
                ...incoming.map((item) => item?.replayOffset ?? 0),
            );
            const addedBytes = incoming.reduce(
                (total, item) => total + Buffer.byteLength(JSON.stringify(item?.event ?? {}), "utf8"),
                0,
            );
            if (eventCount > MAX_REPLAY_EVENTS) {
                return `Replay ${replayId} exceeds the ${MAX_REPLAY_EVENTS} event limit.`;
            }
            if (maxOffset > MAX_REPLAY_DURATION) {
                return `Replay ${replayId} exceeds the ${MAX_REPLAY_DURATION}ms duration limit.`;
            }
            if ((existing?.storedBytes ?? 0) + addedBytes > MAX_REPLAY_BYTES) {
                return `Replay ${replayId} exceeds the ${MAX_REPLAY_BYTES} byte storage limit.`;
            }
        }
        return undefined;
    }

    save(report: unknown): void {
        const envelope = report as EnvelopeRecord;
        const envelopeId = typeof envelope.id === "string" && envelope.id
            ? envelope.id
            : `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const appId = envelope.appId || "legacy";
        const projectName = envelope.projectName || appId;
        const sessionId = envelope.sessionId || "legacy";
        const timestamp = Number.isFinite(envelope.timestamp)
            ? envelope.timestamp as number
            : Date.now();
        const release = envelope.release || "";
        const userId = envelope.user?.id || envelope.userId || "";
        const pageUrl = envelope.environment?.url || "";
        const events = Array.isArray(envelope.data) ? envelope.data : [];
        const replayLimit = this.validateReplayReport(report);
        if (replayLimit) {
            throw new Error(replayLimit);
        }

        const transaction = this.database.transaction(() => {
            const result = this.database.prepare(`
                INSERT OR IGNORE INTO envelopes
                (envelope_id, app_id, project_name, session_id, timestamp, release, user_id, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                envelopeId,
                appId,
                projectName,
                sessionId,
                timestamp,
                release,
                userId,
                json(report),
            );
            if (result.changes === 0) {
                return;
            }
            const insertEvent = this.database.prepare(`
                INSERT INTO events
                (envelope_id, app_id, project_name, session_id, timestamp, release, user_id,
                 page_url, type, sub_type, data_json, raw_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const data of events) {
                const item = asRecord(data);
                const eventResult = insertEvent.run(
                    envelopeId,
                    appId,
                    projectName,
                    sessionId,
                    timestamp,
                    release,
                    userId,
                    pageUrl,
                    typeof item.type === "string" ? item.type : "unknown",
                    typeof item.subType === "string" ? item.subType : "unknown",
                    json(data),
                    json(report),
                );
                const replay = replayData(data);
                if (replay) {
                    const eventTimestamp = Number(replay.event.timestamp);
                    this.database.prepare(`
                        INSERT OR IGNORE INTO replay_sessions
                        (app_id, replay_id, session_id, project_name, user_id, page_url, started_at, last_seen)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        appId,
                        replay.replayId,
                        replay.sessionId,
                        projectName,
                        userId,
                        pageUrl,
                        eventTimestamp - replay.replayOffset,
                        eventTimestamp,
                    );
                    const replayEvent = this.database.prepare(`
                        INSERT OR IGNORE INTO replay_events
                        (app_id, replay_id, timestamp, replay_offset, event_json, is_checkout)
                        VALUES (?, ?, ?, ?, ?, ?)
                    `).run(
                        appId,
                        replay.replayId,
                        replay.event.timestamp,
                        replay.replayOffset,
                        json(replay.event),
                        replay.isCheckout ? 1 : 0,
                    );
                    if (replayEvent.changes > 0) {
                        this.database.prepare(`
                            UPDATE replay_sessions
                            SET last_seen = MAX(last_seen, ?),
                                duration = MAX(duration, ?),
                                event_count = event_count + 1,
                                stored_bytes = stored_bytes + ?,
                                has_snapshot = MAX(has_snapshot, ?)
                            WHERE app_id = ? AND replay_id = ?
                        `).run(
                            eventTimestamp,
                            replay.replayOffset,
                            Buffer.byteLength(json(replay.event), "utf8"),
                            replay.event.type === 2 ? 1 : 0,
                            appId,
                            replay.replayId,
                        );
                    }
                    this.database.prepare(`
                        UPDATE replay_sessions
                        SET error_count = (
                            SELECT COUNT(*) FROM events
                            WHERE app_id = ? AND type = 'error'
                                AND json_extract(data_json, '$.replayId') = ?
                        )
                        WHERE app_id = ? AND replay_id = ?
                    `).run(appId, replay.replayId, appId, replay.replayId);
                }
                const identity = getErrorIdentity(appId, data);
                if (identity) {
                    this.database.prepare(`
                        INSERT INTO error_issues
                        (fingerprint, app_id, sub_type, message, stack, raw_stack, first_seen, last_seen, count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                        ON CONFLICT(fingerprint) DO UPDATE SET
                            first_seen = MIN(first_seen, excluded.first_seen),
                            last_seen = MAX(last_seen, excluded.last_seen),
                            count = count + 1
                    `).run(
                        identity.fingerprint,
                        appId,
                        item.subType,
                        identity.message,
                        identity.stack,
                        identity.rawStack,
                        timestamp,
                        timestamp,
                    );
                    this.database.prepare(`
                        INSERT INTO error_occurrences
                        (event_id, fingerprint, user_id, page_url, release)
                        VALUES (?, ?, ?, ?, ?)
                    `).run(eventResult.lastInsertRowid, identity.fingerprint, userId, pageUrl, release);
                    const errorReplayId = typeof item.replayId === "string"
                        ? item.replayId
                        : undefined;
                    if (errorReplayId) {
                        this.database.prepare(`
                            UPDATE replay_sessions
                            SET error_count = error_count + 1
                            WHERE app_id = ? AND replay_id = ?
                        `).run(appId, errorReplayId);
                    }
                }
            }
        });
        transaction();
    }

    queryErrors(query: ErrorIssueQuery): ErrorIssueQueryResult {
        const filter = errorFilter(query);
        const total = (this.database.prepare(
            `SELECT COUNT(*) AS count FROM error_issues i WHERE ${filter.where}`,
        ).get(...filter.parameters) as { count: number }).count;
        const sort = query.sort === "firstSeen"
            ? "i.first_seen ASC"
            : query.sort === "count" ? "i.count DESC, i.last_seen DESC" : "i.last_seen DESC";
        const offset = (query.page - 1) * query.pageSize;
        const rows = this.database.prepare(`
            SELECT i.fingerprint, i.app_id AS appId, i.sub_type AS subType,
                i.message, i.stack, i.raw_stack AS rawStack, i.status, i.first_seen AS firstSeen,
                i.last_seen AS lastSeen, i.count,
                COUNT(DISTINCT o.user_id) AS userCount,
                json_group_array(DISTINCT o.page_url) AS pages,
                json_group_array(DISTINCT o.release) AS releases,
                COALESCE((
                    SELECT latest.release FROM error_occurrences latest
                    JOIN events latestEvent ON latestEvent.id = latest.event_id
                    WHERE latest.fingerprint = i.fingerprint
                    ORDER BY latestEvent.timestamp DESC, latestEvent.id DESC LIMIT 1
                ), '') AS latestRelease,
                COALESCE((
                    SELECT e.data_json FROM events e
                    JOIN error_occurrences latest ON latest.event_id = e.id
                    WHERE latest.fingerprint = i.fingerprint
                    ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
                ), 'null') AS latestData
            FROM error_issues i
            LEFT JOIN error_occurrences o ON o.fingerprint = i.fingerprint
            WHERE ${filter.where}
            GROUP BY i.fingerprint
            ORDER BY ${sort}, i.fingerprint ASC
            LIMIT ? OFFSET ?
        `).all(...filter.parameters, query.pageSize, offset) as Array<Record<string, unknown>>;
        return {
            items: rows.map((row) => this.issueFromRowWithResolution(row)),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    getError(fingerprint: string): ErrorIssue | undefined {
        const row = this.database.prepare(`
            SELECT i.fingerprint, i.app_id AS appId, i.sub_type AS subType,
                i.message, i.stack, i.raw_stack AS rawStack, i.status, i.first_seen AS firstSeen,
                i.last_seen AS lastSeen, i.count,
                COUNT(DISTINCT o.user_id) AS userCount,
                json_group_array(DISTINCT o.page_url) AS pages,
                json_group_array(DISTINCT o.release) AS releases,
                COALESCE((
                    SELECT latest.release FROM error_occurrences latest
                    JOIN events latestEvent ON latestEvent.id = latest.event_id
                    WHERE latest.fingerprint = i.fingerprint
                    ORDER BY latestEvent.timestamp DESC, latestEvent.id DESC LIMIT 1
                ), '') AS latestRelease,
                COALESCE((
                    SELECT e.data_json FROM events e
                    JOIN error_occurrences latest ON latest.event_id = e.id
                    WHERE latest.fingerprint = i.fingerprint
                    ORDER BY e.timestamp DESC, e.id DESC LIMIT 1
                ), 'null') AS latestData
            FROM error_issues i
            LEFT JOIN error_occurrences o ON o.fingerprint = i.fingerprint
            WHERE i.fingerprint = ?
            GROUP BY i.fingerprint
        `).get(fingerprint) as Record<string, unknown> | undefined;
        return row ? this.issueFromRowWithResolution(row) : undefined;
    }

    private sourceMaps(): SourceMapRecord[] {
        return (this.database.prepare(`
            SELECT app_id AS appId, release, generated_file AS generatedFile,
                source_map_json AS sourceMap
            FROM source_maps
        `).all() as Array<Omit<SourceMapRecord, "sourceMap"> & { sourceMap: string }>)
            .map((row) => ({ ...row, sourceMap: parse(row.sourceMap) }));
    }

    private issueFromRowWithResolution(row: Record<string, unknown>): ErrorIssue {
        const latestData = parse<Record<string, unknown>>(String(row.latestData));
        const stack = String(row.rawStack || row.stack);
        const resolved = resolveStack(
            stack,
            String(row.appId),
            String(row.latestRelease),
            this.sourceMaps(),
        );
        return issueFromRow({
            ...row,
            stackFrames: JSON.stringify(resolved.stackFrames),
            resolutionStatus: resolved.resolutionStatus,
        });
    }

    putSourceMap(upload: SourceMapUpload): "created" | "replaced" | "exists" {
        const existing = this.database.prepare(`
            SELECT 1 FROM source_maps
            WHERE app_id = ? AND release = ? AND generated_file = ?
        `).get(upload.appId, upload.release, upload.generatedFile);
        if (existing && !upload.replace) return "exists";
        this.database.prepare(`
            INSERT INTO source_maps
                (app_id, release, generated_file, source_map_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(app_id, release, generated_file) DO UPDATE SET
                source_map_json = excluded.source_map_json,
                created_at = excluded.created_at
        `).run(
            upload.appId,
            upload.release,
            upload.generatedFile,
            json(upload.sourceMap),
            Date.now(),
        );
        return existing ? "replaced" : "created";
    }

    listSourceMaps(appId?: string, release?: string): Array<{
        appId: string;
        release: string;
        generatedFile: string;
    }> {
        const conditions = ["1 = 1"];
        const parameters: string[] = [];
        if (appId) {
            conditions.push("app_id = ?");
            parameters.push(appId);
        }
        if (release) {
            conditions.push("release = ?");
            parameters.push(release);
        }
        return this.database.prepare(`
            SELECT app_id AS appId, release, generated_file AS generatedFile
            FROM source_maps WHERE ${conditions.join(" AND ")}
            ORDER BY app_id, release, generated_file
        `).all(...parameters) as Array<{
            appId: string;
            release: string;
            generatedFile: string;
        }>;
    }

    errorEvents(fingerprint: string, page: number, pageSize: number): EventQueryResult {
        const total = (this.database.prepare(
            "SELECT COUNT(*) AS count FROM error_occurrences WHERE fingerprint = ?",
        ).get(fingerprint) as { count: number }).count;
        const rows = this.database.prepare(`
            SELECT e.id, e.envelope_id AS envelopeId, e.app_id AS appId,
                e.project_name AS projectName, e.session_id AS sessionId,
                e.timestamp, e.release, e.user_id AS userId, e.page_url AS pageUrl,
                e.type, e.sub_type AS subType, e.data_json AS data, e.raw_json AS raw
            FROM events e
            JOIN error_occurrences o ON o.event_id = e.id
            WHERE o.fingerprint = ?
            ORDER BY e.timestamp DESC, e.id DESC
            LIMIT ? OFFSET ?
        `).all(fingerprint, pageSize, (page - 1) * pageSize) as Array<
            Omit<StoredEvent, "data" | "raw"> & { data: string; raw: string }
        >;
        const maps = this.sourceMaps();
        return {
            items: rows.map((row) => {
                const data = parse<Record<string, unknown>>(row.data);
                const stack = typeof data.stack === "string" ? data.stack : undefined;
                const resolved = stack
                    ? resolveStack(stack, row.appId, row.release, maps)
                    : undefined;
                return {
                    ...row,
                    data: resolved
                        ? {
                            ...data,
                            stackFrames: resolved.stackFrames,
                            resolutionStatus: resolved.resolutionStatus,
                        }
                        : data,
                    raw: parse(row.raw),
                };
            }),
            total,
            page,
            pageSize,
        };
    }

    updateErrorStatus(fingerprint: string, status: ErrorStatus): boolean {
        return this.database.prepare(
            "UPDATE error_issues SET status = ? WHERE fingerprint = ?",
        ).run(status, fingerprint).changes > 0;
    }

    queryReplays(query: ReplayQuery): ReplayListResult {
        const conditions = ["1 = 1"];
        const parameters: Array<string | number> = [];
        if (query.appId) {
            conditions.push("app_id = ?");
            parameters.push(query.appId);
        }
        if (query.replayId) {
            conditions.push("replay_id = ?");
            parameters.push(query.replayId);
        }
        if (query.userId) {
            conditions.push("user_id = ?");
            parameters.push(query.userId);
        }
        if (query.from !== undefined) {
            conditions.push("last_seen >= ?");
            parameters.push(query.from);
        }
        if (query.to !== undefined) {
            conditions.push("started_at <= ?");
            parameters.push(query.to);
        }
        const where = conditions.join(" AND ");
        const total = (this.database.prepare(
            `SELECT COUNT(*) AS count FROM replay_sessions WHERE ${where}`,
        ).get(...parameters) as { count: number }).count;
        const rows = this.database.prepare(`
            SELECT app_id AS appId, project_name AS projectName,
                replay_id AS replayId, session_id AS sessionId,
                user_id AS userId, page_url AS pageUrl,
                started_at AS startedAt, last_seen AS lastSeen,
                duration, event_count AS eventCount, error_count AS errorCount,
                CASE WHEN has_snapshot = 1 THEN 'ready' ELSE 'incomplete' END AS status
            FROM replay_sessions
            WHERE ${where}
            ORDER BY last_seen DESC, replay_id ASC
            LIMIT ? OFFSET ?
        `).all(...parameters, query.pageSize, (query.page - 1) * query.pageSize) as Array<Record<string, unknown>>;
        return {
            items: rows.map((row) => ({
                appId: String(row.appId),
                projectName: String(row.projectName),
                replayId: String(row.replayId),
                sessionId: String(row.sessionId),
                userId: String(row.userId),
                pageUrl: String(row.pageUrl),
                startedAt: Number(row.startedAt),
                lastSeen: Number(row.lastSeen),
                duration: Number(row.duration),
                eventCount: Number(row.eventCount),
                errorCount: Number(row.errorCount),
                status: row.status as ReplaySession["status"],
            })),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    getReplay(
        replayId: string,
        appId?: string,
    ): ReplayDetail | undefined {
        const session = this.queryReplays({
            appId,
            replayId,
            page: 1,
            pageSize: 1,
        }).items[0];
        if (!session) return undefined;
        const rows = this.database.prepare(`
            SELECT timestamp, replay_offset AS replayOffset,
                event_json AS event, is_checkout AS isCheckout
            FROM replay_events
            WHERE app_id = ? AND replay_id = ?
            ORDER BY replay_offset ASC, id ASC
        `).all(session.appId, replayId) as Array<Record<string, unknown>>;
        try {
            return {
                session,
                events: rows.map((row) => ({
                    timestamp: Number(row.timestamp),
                    replayOffset: Number(row.replayOffset),
                    event: parse<Record<string, unknown>>(String(row.event)),
                    isCheckout: Number(row.isCheckout) === 1,
                })),
            };
        } catch {
            return {
                session: { ...session, status: "unplayable" },
                events: [],
            };
        }
    }

    list(): unknown[] {
        const rows = this.database.prepare(`
            SELECT raw_json FROM envelopes ORDER BY timestamp DESC, rowid DESC
        `).all() as Array<{ raw_json: string }>;
        return rows.map((row) => parse(row.raw_json));
    }

    apps(): Array<{ appId: string; projectName: string }> {
        return this.database.prepare(`
            SELECT e.app_id AS appId, e.project_name AS projectName
            FROM envelopes e
            WHERE e.rowid = (
                SELECT latest.rowid FROM envelopes latest
                WHERE latest.app_id = e.app_id
                ORDER BY latest.timestamp DESC, latest.rowid DESC
                LIMIT 1
            )
            ORDER BY appId ASC
        `).all() as Array<{ appId: string; projectName: string }>;
    }

    queryEvents(query: EventQuery): EventQueryResult {
        const filter = eventFilter(query);
        const total = (this.database.prepare(
            `SELECT COUNT(*) AS count FROM events WHERE ${filter.where}`,
        ).get(...filter.parameters) as { count: number }).count;
        const offset = (query.page - 1) * query.pageSize;
        const rows = this.database.prepare(`
            SELECT id, envelope_id AS envelopeId, app_id AS appId,
                project_name AS projectName, session_id AS sessionId,
                timestamp, release, user_id AS userId, page_url AS pageUrl,
                type, sub_type AS subType, data_json AS data, raw_json AS raw
            FROM events
            WHERE ${filter.where}
            ORDER BY timestamp DESC, id DESC
            LIMIT ? OFFSET ?
        `).all(...filter.parameters, query.pageSize, offset) as Array<
            Omit<StoredEvent, "data" | "raw"> & { data: string; raw: string }
        >;
        return {
            items: rows.map((row) => ({
                ...row,
                data: parse(row.data),
                raw: parse(row.raw),
            })),
            total,
            page: query.page,
            pageSize: query.pageSize,
        };
    }

    summary(query: Omit<EventQuery, "page" | "pageSize">): {
        total: number;
        byType: Array<{ type: string; count: number }>;
    } {
        const result = this.queryEvents({ ...query, page: 1, pageSize: 1 });
        const filter = eventFilter(query);
        const rows = this.database.prepare(`
            SELECT type, COUNT(*) AS count FROM events
            WHERE ${filter.where}
            GROUP BY type ORDER BY count DESC, type ASC
        `).all(...filter.parameters) as Array<{ type: string; count: number }>;
        return { total: result.total, byType: rows };
    }

    private performanceEvents(
        query: PerformanceFilter,
        subTypes?: string[],
    ): PerformanceEventRow[] {
        const conditions = ["type = 'performance'"];
        const parameters: Array<string | number> = [];
        if (query.appId) {
            conditions.push("app_id = ?");
            parameters.push(query.appId);
        }
        if (query.from !== undefined) {
            conditions.push("timestamp >= ?");
            parameters.push(query.from);
        }
        if (query.to !== undefined) {
            conditions.push("timestamp <= ?");
            parameters.push(query.to);
        }
        if (subTypes?.length) {
            conditions.push(`sub_type IN (${subTypes.map(() => "?").join(", ")})`);
            parameters.push(...subTypes);
        }
        const rows = this.database.prepare(`
            SELECT id, timestamp, page_url AS pageUrl, sub_type AS subType, data_json AS data
            FROM events WHERE ${conditions.join(" AND ")}
            ORDER BY timestamp DESC, id DESC
        `).all(...parameters) as Array<PerformanceEventRow & { data: string }>;
        return rows
            .map((row) => {
                const data = parse<Record<string, unknown>>(row.data);
                return {
                    ...row,
                    pageUrl: typeof data.pageUrl === "string" ? data.pageUrl : row.pageUrl,
                    data,
                };
            })
            .filter((row) => {
                if (query.pageUrl && row.pageUrl !== query.pageUrl) return false;
                if (query.minDuration === undefined && query.maxDuration === undefined) return true;
                const duration = typeof row.data.duration === "number" ? row.data.duration : undefined;
                return duration !== undefined &&
                    (query.minDuration === undefined || duration >= query.minDuration) &&
                    (query.maxDuration === undefined || duration <= query.maxDuration);
            });
    }

    performanceMetrics(query: PerformanceMetricQuery): PerformanceMetricPoint[] {
        return summarizeMetrics(this.performanceEvents(query), query);
    }

    viewPaintMetrics(query: ViewPaintMetricQuery): ViewPaintMetricPoint[] {
        return summarizeViewPaintMetrics(
            this.performanceEvents(query, [
                "view-first-contentful-paint",
                "view-largest-contentful-paint",
            ]),
            query,
        );
    }

    performanceRequests(query: RequestQuery): PerformanceListResult<PerformanceRequest> {
        const rows = this.performanceEvents(query, ["fetch", "xhr"])
            .flatMap((row) => {
                const url = typeof row.data.url === "string" ? row.data.url : "";
                if (query.keyword && !url.toLowerCase().includes(query.keyword.toLowerCase())) return [];
                const status = typeof row.data.status === "number" ? row.data.status : 0;
                if (query.status !== undefined && status !== query.status) return [];
                const duration = typeof row.data.duration === "number" ? row.data.duration : 0;
                return [{
                    id: row.id,
                    timestamp: row.timestamp,
                    pageUrl: row.pageUrl,
                    url,
                    method: typeof row.data.method === "string" ? row.data.method : "",
                    status,
                    duration,
                    success: row.data.success === true,
                    subType: row.subType as "fetch" | "xhr",
                }];
            });
        const direction = query.order === "asc" ? 1 : -1;
        rows.sort((left, right) => {
            const comparison = query.sort === "status"
                ? left.status - right.status
                : query.sort === "url"
                    ? left.url.localeCompare(right.url)
                    : left.duration - right.duration;
            return comparison * direction || right.id - left.id;
        });
        return this.paginate(rows, query.page, query.pageSize);
    }

    performanceResources(query: ResourceQuery): PerformanceListResult<PerformanceResource> {
        const rows = this.performanceEvents(query, ["resource"])
            .flatMap((row) => {
                const url = typeof row.data.name === "string" ? row.data.name : "";
                const resourceType = typeof row.data.sourceType === "string" ? row.data.sourceType : "";
                if (query.keyword && !url.toLowerCase().includes(query.keyword.toLowerCase())) return [];
                if (query.resourceType && resourceType !== query.resourceType) return [];
                return [{
                    id: row.id,
                    timestamp: row.timestamp,
                    pageUrl: row.pageUrl,
                    url,
                    resourceType,
                    duration: typeof row.data.duration === "number" ? row.data.duration : 0,
                    transferSize: typeof row.data.transferSize === "number" ? row.data.transferSize : 0,
                    resourceSize: typeof row.data.resourceSize === "number" ? row.data.resourceSize : 0,
                }];
            });
        const direction = query.order === "asc" ? 1 : -1;
        rows.sort((left, right) => {
            const comparison = query.sort === "url"
                ? left.url.localeCompare(right.url)
                : left.duration - right.duration;
            return comparison * direction || right.id - left.id;
        });
        return this.paginate(rows, query.page, query.pageSize);
    }

    private paginate<T>(items: T[], page: number, pageSize: number): PerformanceListResult<T> {
        return {
            items: items.slice((page - 1) * pageSize, page * pageSize),
            total: items.length,
            page,
            pageSize,
        };
    }

    cleanupBefore(cutoff: number): {
        envelopes: number;
        events: number;
        errors: number;
        replays: number;
        sourceMaps: number;
    } {
        const transaction = this.database.transaction(() => {
            const eventIds = this.database.prepare(
                "SELECT id FROM events WHERE timestamp < ?",
            ).all(cutoff) as Array<{ id: number }>;
            const replayIds = this.database.prepare(
                "SELECT app_id AS appId, replay_id AS replayId FROM replay_sessions WHERE last_seen < ?",
            ).all(cutoff) as Array<{ appId: string; replayId: string }>;
            for (const row of eventIds) {
                this.database.prepare(
                    "DELETE FROM error_occurrences WHERE event_id = ?",
                ).run(row.id);
            }
            const eventResult = this.database.prepare(
                "DELETE FROM events WHERE timestamp < ?",
            ).run(cutoff);
            const envelopeResult = this.database.prepare(
                "DELETE FROM envelopes WHERE timestamp < ?",
            ).run(cutoff);
            for (const row of replayIds) {
                this.database.prepare(
                    "DELETE FROM replay_events WHERE app_id = ? AND replay_id = ?",
                ).run(row.appId, row.replayId);
            }
            const replayResult = this.database.prepare(
                "DELETE FROM replay_sessions WHERE last_seen < ?",
            ).run(cutoff);
            const orphanResult = this.database.prepare(`
                DELETE FROM error_issues
                WHERE NOT EXISTS (
                    SELECT 1 FROM error_occurrences
                    WHERE error_occurrences.fingerprint = error_issues.fingerprint
                )
            `).run();
            const sourceMapResult = this.database.prepare(
                "DELETE FROM source_maps WHERE created_at < ?",
            ).run(cutoff);
            return {
                envelopes: envelopeResult.changes,
                events: eventResult.changes,
                errors: orphanResult.changes,
                replays: replayResult.changes,
                sourceMaps: sourceMapResult.changes,
            };
        });
        return transaction();
    }

    clearAll(): {
        envelopes: number;
        events: number;
        errors: number;
        replays: number;
        sourceMaps: number;
    } {
        const transaction = this.database.transaction(() => {
            this.database.prepare("DELETE FROM error_occurrences").run();
            const eventResult = this.database.prepare("DELETE FROM events").run();
            const envelopeResult = this.database.prepare(
                "DELETE FROM envelopes",
            ).run();
            this.database.prepare("DELETE FROM replay_events").run();
            const replayResult = this.database.prepare(
                "DELETE FROM replay_sessions",
            ).run();
            const errorResult = this.database.prepare(
                "DELETE FROM error_issues",
            ).run();
            const sourceMapResult = this.database.prepare(
                "DELETE FROM source_maps",
            ).run();
            return {
                envelopes: envelopeResult.changes,
                events: eventResult.changes,
                errors: errorResult.changes,
                replays: replayResult.changes,
                sourceMaps: sourceMapResult.changes,
            };
        });
        return transaction();
    }

    close(): void {
        this.database.close();
    }
}
