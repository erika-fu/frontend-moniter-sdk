import { DEFAULT_RETENTION_DAYS, SQLiteReportStore } from "./store.js";

const retentionDays = Number.parseInt(
    process.env.RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10,
);
if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("RETENTION_DAYS must be a positive integer.");
}

const databasePath =
    process.env.REPORT_DB_PATH ??
    new URL("./data/monitoring.sqlite", import.meta.url).pathname;
const store = new SQLiteReportStore(databasePath);
try {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = store.cleanupBefore(cutoff);
    console.log(JSON.stringify({
        databasePath,
        retentionDays,
        cutoff,
        ...result,
    }));
} finally {
    store.close();
}
