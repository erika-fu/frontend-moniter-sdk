import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : {};
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
        `);
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
                insertEvent.run(
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
            }
        });
        transaction();
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
