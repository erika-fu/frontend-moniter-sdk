// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
    JavaScriptErrorReportData,
    PageViewReportData,
} from "../../src/index.js";
import { App } from "./App.js";
import { addReport, clearReports } from "./reportStore.js";

let container: HTMLDivElement;
let root: Root;

function createPageView(): PageViewReportData {
    return {
        type: "behavior",
        subType: "pv",
        startTime: 1,
        pageUrl: "https://example.test/",
        referrer: "",
        uuid: "page-view",
        viewId: "page-view",
        startSource: "manual",
    };
}

function createJavaScriptError(): JavaScriptErrorReportData {
    return {
        type: "error",
        subType: "js",
        msg: "demo error",
        url: "https://example.test/app.js",
        lineNo: 1,
        columnNo: 2,
        startTime: 3,
        pageUrl: "https://example.test/",
    };
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.location.hash = "#/console";
    clearReports();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    clearReports();
});

describe("React monitor app", () => {
    it("renders the view selected by the hash route", () => {
        act(() => root.render(<App reportUrl="/reportData" />));

        expect(container.querySelector("h1")?.textContent).toBe(
            "React 监控台",
        );

        act(() => {
            window.location.hash = "#/reports";
            window.dispatchEvent(new HashChangeEvent("hashchange"));
        });

        expect(container.querySelector("h1")?.textContent).toBe(
            "报告归档",
        );
    });

    it("filters visible reports by their top-level type", () => {
        addReport(createPageView());
        addReport(createJavaScriptError());
        act(() => root.render(<App reportUrl="/reportData" />));

        const errorFilter = [...container.querySelectorAll("button")].find(
            (button) => button.textContent?.includes("错误"),
        );
        expect(errorFilter).toBeDefined();

        act(() => {
            errorFilter?.dispatchEvent(
                new MouseEvent("click", { bubbles: true }),
            );
        });

        const visibleReports = container.querySelectorAll(".report-row");
        expect(visibleReports).toHaveLength(1);
        expect(visibleReports[0]?.textContent).toContain("demo error");
        expect(visibleReports[0]?.textContent).not.toContain("page-view");
    });
});
