import { computed, ref, shallowRef } from "vue";
import type {
    ReplayEventReportData,
    SDKReportData,
} from "frontend-moniter-sdk";
import {
    createReplayTimeline,
    type ReplayTimeline,
} from "./replayTimeline.js";

export const reports = shallowRef<SDKReportData[]>([]);
const replayReports = shallowRef<ReplayEventReportData[]>([]);
const MAX_REPLAY_REPORTS = 1000;

export function addReport(report: SDKReportData): void {
    reports.value = [report, ...reports.value].slice(0, 100);
    if (isReplayReport(report)) {
        replayReports.value = [
            report,
            ...replayReports.value,
        ].slice(0, MAX_REPLAY_REPORTS);
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

export const replaySessions = computed<ReplayTimeline[]>(() => {
    const sessionReports = new Map<string, ReplayEventReportData[]>();

    for (const report of replayReports.value) {
        const reports = sessionReports.get(report.replayId) ?? [];
        reports.push(report);
        sessionReports.set(report.replayId, reports);
    }

    return [...sessionReports.values()].map(createReplayTimeline);
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
