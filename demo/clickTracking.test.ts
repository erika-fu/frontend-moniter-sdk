/**
 * @vitest-environment jsdom
 */
import { createApp, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("frontend-moniter-sdk", () => ({
    getReplaySession: vi.fn(),
    observeReplay: vi.fn(),
    stopObserveReplay: vi.fn(),
}));

import {
    observeBehavior,
    stopObserveBehavior,
} from "../src/behavior/index.js";
import { subscribeReports } from "../src/report.js";
import App from "./src/App.vue";
import { startDemoMonitoring } from "./src/startMonitoring.js";

describe("Vue demo click markers", () => {
    let container: HTMLDivElement | undefined;
    let unsubscribe = () => {};

    afterEach(() => {
        unsubscribe();
        unsubscribe = () => {};
        stopObserveBehavior();
        container?.remove();
        container = undefined;
    });

    it("reports only controls marked with stable clstag values", async () => {
        const clickReports: Array<{ attributes?: Record<string, string> }> =
            [];
        unsubscribe = subscribeReports((data) => {
            if (
                typeof data === "object" &&
                data !== null &&
                "subType" in data &&
                data.subType === "click"
            ) {
                clickReports.push(
                    data as { attributes?: Record<string, string> },
                );
            }
        });
        startDemoMonitoring({
            init() {},
            performance() {},
            behavior: observeBehavior,
            error() {},
        });

        container = document.createElement("div");
        document.body.append(container);
        const app = createApp(App);
        app.mount(container);

        expect(
            [...container.querySelectorAll("[clstag]")].map((element) =>
                element.getAttribute("clstag"),
            ),
        ).toEqual([
            "switch-hash-route-to-orders",
            "switch-hash-route-to-profile",
            "switch-history-route-to-orders",
            "switch-history-route-to-profile",
        ]);

        const unmarked = [...container.querySelectorAll("button")].find(
            (button) => button.textContent?.trim() === "未标记对照",
        );
        expect(unmarked).toBeInstanceOf(HTMLButtonElement);
        expect(unmarked?.hasAttribute("clstag")).toBe(false);

        unmarked?.click();
        await nextTick();

        expect(container.textContent).toContain("未标记对照已执行");
        expect(clickReports).toEqual([]);
        expect(container.textContent).toContain(
            "只有携带 clstag 标记的控件才会产生行为点击上报",
        );

        const ordersButton = container.querySelector(
            "[clstag='switch-hash-route-to-orders']",
        );
        expect(ordersButton).toBeInstanceOf(HTMLButtonElement);
        (ordersButton as HTMLButtonElement).click();
        expect(window.location.hash).toBe("#/scenario/orders");
        expect(clickReports).toEqual([
            expect.objectContaining({
                attributes: { clstag: "switch-hash-route-to-orders" },
            }),
        ]);

        expect(container.textContent).toContain("Fetch 成功");
        expect(container.textContent).toContain("JavaScript 异常");
        expect(container.textContent).toContain("开始录屏");

        app.unmount();
    });
});
