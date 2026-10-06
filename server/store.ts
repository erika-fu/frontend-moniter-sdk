import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isSourceMap, resolveStack, type SourceMapRecord, type SourceMapResolutionStatus } from "./sourceMaps.js";
import {
    getErrorIdentity,
    type ErrorStatus,
} from "./errorIssues.js";

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
        `);
        try {
            this.database.exec(
                "ALTER TABLE error_issues ADD COLUMN raw_stack TEXT NOT NULL DEFAULT ''",
            );
        } catch {
            // Existing databases already have the column.
        }
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

    close(): void {
        this.database.close();
    }
}
