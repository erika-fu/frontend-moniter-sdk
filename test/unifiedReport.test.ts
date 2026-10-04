import { afterEach, describe, expect, it, vi } from "vitest";

const { lazyReportBatch } = vi.hoisted(() => ({
  lazyReportBatch: vi.fn(() => false),
}));

vi.mock("../src/report.js", () => ({
  lazyReportBatch,
  createReportHandler: vi.fn(),
  setConfig: vi.fn(),
}));

import {
  observeError,
  stopObserveError,
} from "../src/error/index.js";
import { observeLoad } from "../src/performance/observeLoad.js";
import { observePV } from "../src/behavior/pv.js";

describe("unified metric reporting", () => {
  afterEach(() => {
    stopObserveError();
    vi.unstubAllGlobals();
    lazyReportBatch.mockClear();
  });

  it("queues behavior, runtime error, and performance data in batches", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener: vi.fn(),
      onerror: null,
      requestAnimationFrame: (callback: () => void) => callback(),
    });
    vi.stubGlobal("document", {
      referrer: "",
      readyState: "complete",
    });
    vi.stubGlobal("performance", {
      now: () => 12,
      getEntriesByType: () => [
        { loadEventEnd: 80, startTime: 10 },
      ],
    });
    vi.stubGlobal("crypto", { randomUUID: () => "behavior-id" });

    observePV(onReport);
    observeError(onReport);
    window.onerror?.("boom", "app.js", 1, 2, new Error("boom"));
    observeLoad(onReport);

    expect(lazyReportBatch).toHaveBeenCalledTimes(3);
    expect(lazyReportBatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "behavior", subType: "pv" }),
    );
    expect(lazyReportBatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "error", subType: "js" }),
    );
    expect(lazyReportBatch).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: "performance", subType: "load" }),
    );
    expect(onReport).toHaveBeenCalledTimes(3);
  });
});
