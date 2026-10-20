/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    failResource,
    probeSoftNavigationViewPaintSupport,
    pushHistoryRoute,
    requestWithFetch,
    requestWithXHR,
    runKeyContentPaintScenario,
    runSkeletonToContentScenario,
    runSoftNavigationViewPaintScenario,
    runViewLargestContentfulPaintScenario,
    stopSoftNavigationViewPaintDemo,
    switchRoute,
} from "../demo/src/scenarios.js";
import { stopObserveBehavior } from "../src/behavior/index.js";
import { resetKeyContentPaint } from "../src/performance/observeKeyContentPaint.js";
import { resetSoftNavigationViewPaint } from "../src/performance/observeSoftNavigationViewPaint.js";
import { resetViewFirstContentfulPaint } from "../src/performance/observeViewFCP.js";
import { resetViewLargestContentfulPaint } from "../src/performance/observeViewLCP.js";

describe("demo monitoring scenarios", () => {
    afterEach(() => {
        stopSoftNavigationViewPaintDemo();
        resetSoftNavigationViewPaint();
        resetViewFirstContentfulPaint();
        resetViewLargestContentfulPaint();
        resetKeyContentPaint();
        stopObserveBehavior();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("sends successful and failed Fetch requests to distinct URLs", () => {
        const fetchMock = vi.fn(() => Promise.reject(new Error("network")));
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("window", {
            location: { pathname: "/demo" },
        });

        requestWithFetch(true);
        requestWithFetch(false);

        expect(fetchMock).toHaveBeenNthCalledWith(1, "/demo");
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            expect.stringMatching(/^\/sdk-demo-fetch-\d+\.json$/),
        );
    });

    it("sends successful and failed XHR requests to distinct URLs", () => {
        const open = vi.fn();
        const send = vi.fn();
        vi.stubGlobal(
            "XMLHttpRequest",
            class {
                open = open;
                send = send;
            },
        );
        vi.stubGlobal("window", {
            location: { pathname: "/demo" },
        });

        requestWithXHR(true);
        requestWithXHR(false);

        expect(open).toHaveBeenNthCalledWith(1, "GET", "/demo");
        expect(open).toHaveBeenNthCalledWith(
            2,
            "GET",
            expect.stringMatching(/^\/sdk-demo-xhr-\d+\.json$/),
        );
        expect(send).toHaveBeenCalledTimes(2);
    });

    it("switches hash routes and creates a failing resource", () => {
        const image = {
            hidden: false,
            addEventListener: vi.fn(),
        };
        const append = vi.fn();
        vi.stubGlobal("Image", vi.fn(() => image));
        vi.stubGlobal("window", {
            location: { hash: "", pathname: "/demo" },
        });
        vi.stubGlobal("document", { body: { append } });

        switchRoute("#/scenario/orders");
        failResource();

        expect(window.location.hash).toBe("#/scenario/orders");
        expect(image.hidden).toBe(true);
        expect(image.addEventListener).toHaveBeenCalledWith(
            "error",
            expect.any(Function),
            { once: true },
        );
        expect(append).toHaveBeenCalledWith(image);
        expect(image).toHaveProperty("src");
    });

    it("pushes history routes through the History API", () => {
        const pushState = vi.fn();
        vi.stubGlobal("window", {
            location: {
                href: "https://demo.example/app#/console",
            },
            history: { pushState },
        });

        pushHistoryRoute("orders");

        expect(pushState).toHaveBeenCalledWith(
            { route: "orders" },
            "",
            expect.objectContaining({
                search: "?route=orders",
            }),
        );
    });

    it("runs a skeleton-to-content View FCP scenario end to end", async () => {
        vi.useFakeTimers();
        const reports: Array<{ subType?: string; measurementSource?: string }> =
            [];
        const { subscribe } = await import("../src/index.js");
        const unsubscribe = subscribe((data) => {
            reports.push(data as { subType?: string; measurementSource?: string });
        });

        window.history.replaceState({}, "", "/demo");
        const scenario = runSkeletonToContentScenario("declared-content", 400);
        expect(scenario.phase).toBe("skeleton");
        expect(
            scenario.root.querySelector("[data-view-skeleton]"),
        ).not.toBeNull();
        expect(
            reports.some((r) => r.subType === "view-first-contentful-paint"),
        ).toBe(false);

        await vi.advanceTimersByTimeAsync(400);
        await Promise.resolve();

        expect(scenario.phase).toBe("content");
        expect(
            reports.some(
                (r) =>
                    r.subType === "view-first-contentful-paint" &&
                    r.measurementSource === "declared-content",
            ),
        ).toBe(true);

        scenario.dispose();
        unsubscribe();
    });

    it("probes Soft Navigation support and can start a soft-navigation Page View scenario", () => {
        window.history.replaceState({}, "", "/demo");
        const support = probeSoftNavigationViewPaintSupport();
        expect(support.status).toEqual(
            expect.objectContaining({
                status: expect.stringMatching(/supported|unsupported/),
            }),
        );
        stopSoftNavigationViewPaintDemo();

        const scenarioSupport = runSoftNavigationViewPaintScenario();
        expect(window.location.hash).toContain("/scenario/soft-navigation");
        expect(scenarioSupport.supported).toBe(support.supported);
    });

    it("shows candidate replacement and a larger excluded region before one view LCP report", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        let clock = 1_000;
        vi.spyOn(performance, "now").mockImplementation(() => clock);
        const reports: Array<{
            subType?: string;
            value?: number;
            finalizationReason?: string;
            measurementSource?: string;
        }> = [];
        const { subscribe } = await import("../src/index.js");
        const unsubscribe = subscribe((data) => {
            reports.push(
                data as {
                    subType?: string;
                    value?: number;
                    finalizationReason?: string;
                    measurementSource?: string;
                },
            );
        });

        window.history.replaceState({}, "", "/demo");
        const scenario = runViewLargestContentfulPaintScenario({
            replacementDelay: 400,
            timeout: 1_000,
        });
        const area = (selector: string) => {
            const element = scenario.root.querySelector(selector) as HTMLElement | null;
            const width = Number.parseFloat(element?.style.width ?? "0");
            const height = Number.parseFloat(element?.style.height ?? "0");
            return width * height;
        };
        expect(scenario.phase).toBe("small");
        expect(area("[data-view-lcp-candidate='small']")).toBeGreaterThan(0);
        expect(area("[data-view-advertising] [data-view-lcp-excluded]")).toBeGreaterThan(
            area("[data-view-lcp-candidate='small']"),
        );
        expect(
            reports.some((report) => report.subType === "view-largest-contentful-paint"),
        ).toBe(false);

        clock = 1_400;
        await vi.advanceTimersByTimeAsync(400);
        await Promise.resolve();
        expect(scenario.phase).toBe("replaced");
        expect(area("[data-view-lcp-candidate='large']")).toBeGreaterThan(
            area("[data-view-lcp-candidate='small']"),
        );
        expect(area("[data-view-advertising] [data-view-lcp-excluded]")).toBeGreaterThan(
            area("[data-view-lcp-candidate='large']"),
        );
        expect(
            reports.some((report) => report.subType === "view-largest-contentful-paint"),
        ).toBe(false);

        clock = 2_000;
        await vi.advanceTimersByTimeAsync(600);
        const reported = reports.filter(
            (report) => report.subType === "view-largest-contentful-paint",
        );
        expect(reported).toEqual([
            expect.objectContaining({
                value: 400,
                finalizationReason: "timeout",
                measurementSource: "declared-region",
            }),
        ]);

        scenario.dispose();
        unsubscribe();
    });

    it("contrasts a larger visual with smaller key content for Key Content Paint", async () => {
        vi.useFakeTimers();
        const reports: Array<{
            subType?: string;
            keyContentName?: string;
            measurementSource?: string;
        }> = [];
        const { subscribe } = await import("../src/index.js");
        const unsubscribe = subscribe((data) => {
            reports.push(
                data as {
                    subType?: string;
                    keyContentName?: string;
                    measurementSource?: string;
                },
            );
        });

        window.history.replaceState({}, "", "/demo");
        const scenario = runKeyContentPaintScenario({
            keyDelay: 400,
            keyContentName: "product-price",
        });
        expect(scenario.phase).toBe("visual-only");
        expect(
            scenario.root.querySelector("[data-key-content-visual='large']"),
        ).not.toBeNull();
        expect(
            reports.some((report) => report.subType === "key-content-paint"),
        ).toBe(false);
        expect(
            reports.some(
                (report) => report.subType === "view-largest-contentful-paint",
            ),
        ).toBe(false);

        await vi.advanceTimersByTimeAsync(400);
        await Promise.resolve();

        expect(scenario.phase).toBe("key-ready");
        const critical = scenario.root.querySelector(
            "[data-key-content-critical]",
        ) as HTMLElement | null;
        const visual = scenario.root.querySelector(
            "[data-key-content-visual='large']",
        ) as HTMLElement | null;
        expect(critical).not.toBeNull();
        expect(
            Number.parseFloat(visual?.style.width ?? "0") *
                Number.parseFloat(visual?.style.height ?? "0"),
        ).toBeGreaterThan(
            Number.parseFloat(critical?.style.width ?? "0") *
                Number.parseFloat(critical?.style.height ?? "0"),
        );
        expect(
            reports.filter((report) => report.subType === "key-content-paint"),
        ).toEqual([
            expect.objectContaining({
                subType: "key-content-paint",
                keyContentName: "product-price",
                measurementSource: "declared-content",
            }),
        ]);

        scenario.dispose();
        unsubscribe();
    });
});
