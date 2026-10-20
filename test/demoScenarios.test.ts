/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    failResource,
    pushHistoryRoute,
    requestWithFetch,
    requestWithXHR,
    runSkeletonToContentScenario,
    switchRoute,
} from "../demo/src/scenarios.js";
import { stopObserveBehavior } from "../src/behavior/index.js";
import { resetViewFirstContentfulPaint } from "../src/performance/observeViewFCP.js";

describe("demo monitoring scenarios", () => {
    afterEach(() => {
        resetViewFirstContentfulPaint();
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
});
