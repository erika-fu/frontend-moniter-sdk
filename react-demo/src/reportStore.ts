import type { SDKReportData } from "../../src/index.js";

export interface ReportEntry {
    id: number;
    capturedAt: number;
    data: SDKReportData;
}

type StoreListener = () => void;

let nextId = 1;
let reports: ReportEntry[] = [];
const listeners = new Set<StoreListener>();

function emitChange(): void {
    for (const listener of listeners) {
        listener();
    }
}

export function addReport(data: SDKReportData): void {
    reports = [
        {
            id: nextId++,
            capturedAt: Date.now(),
            data,
        },
        ...reports,
    ].slice(0, 100);
    emitChange();
}

export function clearReports(): void {
    reports = [];
    emitChange();
}

export function getReports(): ReportEntry[] {
    return reports;
}

export function subscribeToReports(listener: StoreListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
