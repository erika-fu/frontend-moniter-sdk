import { computed, ref } from "vue";
import type { SDKReportData } from "../../src/index.js";

export const reports = ref<SDKReportData[]>([]);

export function addReport(report: SDKReportData): void {
    reports.value = [report, ...reports.value].slice(0, 100);
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
