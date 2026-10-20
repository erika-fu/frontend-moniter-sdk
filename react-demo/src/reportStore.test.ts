import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageViewReportData } from "../../src/index.js";
import {
    addReport,
    clearReports,
    getReports,
    subscribeToReports,
} from "./reportStore.js";

function createPageView(startTime: number): PageViewReportData {
    return {
        type: "behavior",
        subType: "pv",
        startTime,
        pageUrl: `https://example.test/${startTime}`,
        referrer: "",
        uuid: `report-${startTime}`,
        viewId: `report-${startTime}`,
        startSource: "manual",
    };
}

describe("report store", () => {
    beforeEach(() => {
        clearReports();
    });

    it("publishes newly collected reports to subscribers", () => {
        const listener = vi.fn();
        const unsubscribe = subscribeToReports(listener);

        addReport(createPageView(42));

        expect(listener).toHaveBeenCalledOnce();
        expect(getReports()).toHaveLength(1);
        expect(getReports()[0]?.data).toMatchObject({
            subType: "pv",
            startTime: 42,
        });

        unsubscribe();
        addReport(createPageView(43));
        expect(listener).toHaveBeenCalledOnce();
    });

    it("keeps only the latest 100 reports", () => {
        for (let index = 0; index < 105; index += 1) {
            addReport(createPageView(index));
        }

        const reports = getReports();
        expect(reports).toHaveLength(100);
        expect(reports[0]?.data).toMatchObject({ startTime: 104 });
        expect(reports[99]?.data).toMatchObject({ startTime: 5 });
    });

    it("clears collected reports and notifies subscribers", () => {
        addReport(createPageView(1));
        const listener = vi.fn();
        const unsubscribe = subscribeToReports(listener);

        clearReports();

        expect(getReports()).toEqual([]);
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
    });
});
