import { afterEach, describe, expect, it, vi } from "vitest";
import {
    failResource,
    requestWithFetch,
    requestWithXHR,
    switchRoute,
} from "../demo/src/scenarios.js";

describe("demo monitoring scenarios", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
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
});
