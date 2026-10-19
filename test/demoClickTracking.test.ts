import { describe, expect, it, vi } from "vitest";
import { startDemoMonitoring } from "../demo/src/startMonitoring.js";

describe("Vue demo click tracking", () => {
    it("starts behavior monitoring with clstag and keeps the other monitors", () => {
        const sdk = {
            init: vi.fn(),
            performance: vi.fn(),
            behavior: vi.fn(),
            error: vi.fn(),
        };

        startDemoMonitoring(sdk, {
            url: "https://monitor.example/api/v1/reportData",
        });

        expect(sdk.init).toHaveBeenCalledWith({
            url: "https://monitor.example/api/v1/reportData",
            projectName: "frontend-moniter-sdk-demo",
            appId: "vue-demo",
            userId: "local-developer",
            release: "demo@0.1.0",
            batchSize: 1,
        });
        expect(sdk.performance).toHaveBeenCalledTimes(1);
        expect(sdk.behavior).toHaveBeenCalledWith({
            clickAttributes: ["clstag"],
        });
        expect(sdk.error).toHaveBeenCalledTimes(1);
    });
});
