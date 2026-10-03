import { computed, ref } from "vue";
import type { PerformanceReportData } from "../performance/index.js";

export const reports = ref<PerformanceReportData[]>([]);

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
