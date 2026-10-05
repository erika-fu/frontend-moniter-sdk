import { computed, ref, shallowRef } from "vue";
import type {
    ReplayEventReportData,
    SDKReportData,
} from "../../src/index.js";

export const reports = shallowRef<SDKReportData[]>([]);
const replayReports = shallowRef<ReplayEventReportData[]>([]);

export function addReport(report: SDKReportData): void {
    reports.value = [report, ...reports.value].slice(0, 100);
    if (isReplayReport(report)) {
        replayReports.value = [report, ...replayReports.value];
    }
}

export const reportTypes = computed(() => {
    const counts = new Map<string, number>();

    for (const report of reports.value) {
        counts.set(report.subType, (counts.get(report.subType) ?? 0) + 1);
    }

    return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
});

export function clearReports(): void {
    reports.value = [];
    replayReports.value = [];
}

export function getReportLocation(report: SDKReportData): string {
    if ("pageUrl" in report) {
        return report.pageUrl;
    }
    if ("to" in report) {
        return report.to;
    }
    return window.location.href;
}

export function isReplayReport(
    report: SDKReportData,
): report is ReplayEventReportData {
    return report.type === "replay" && report.subType === "event";
}

export interface ReplaySessionView {
    id: string;
    events: ReplayEventReportData["event"][];
    firstTimestamp: number;
    lastTimestamp: number;
    firstReplayOffset: number;
}

export const replaySessions = computed<ReplaySessionView[]>(() => {
    const sessions = new Map<string, ReplaySessionView>();

    for (const report of replayReports.value) {
        const session = sessions.get(report.replayId) ?? {
            id: report.replayId,
            events: [],
            firstTimestamp: report.startTime,
            lastTimestamp: report.startTime,
            firstReplayOffset: report.replayOffset,
        };
        session.events.push(report.event);
        session.firstTimestamp = Math.min(
            session.firstTimestamp,
            report.startTime,
        );
        session.lastTimestamp = Math.max(
            session.lastTimestamp,
            report.startTime,
        );
        session.firstReplayOffset = Math.min(
            session.firstReplayOffset,
            report.replayOffset,
        );
        sessions.set(report.replayId, session);
    }

    for (const session of sessions.values()) {
        session.events.sort((a, b) => a.timestamp - b.timestamp);
    }

    return [...sessions.values()];
});

export function getReplayContext(
    report: SDKReportData,
): { replayId: string; replayOffset?: number } | undefined {
    if (!("replayId" in report) || typeof report.replayId !== "string") {
        return undefined;
    }

    return {
        replayId: report.replayId,
        ...("replayOffset" in report &&
        typeof report.replayOffset === "number"
            ? { replayOffset: report.replayOffset }
            : {}),
    };
}

export function getReplayRoute(
    report: SDKReportData,
):
    | {
          path: string;
          query: { replayId: string; replayOffset?: string };
      }
    | undefined {
    const context = getReplayContext(report);
    if (!context) {
        return undefined;
    }

    return {
        path: "/replay",
        query: {
            replayId: context.replayId,
            ...(context.replayOffset === undefined
                ? {}
                : { replayOffset: String(context.replayOffset) }),
        },
    };
}
