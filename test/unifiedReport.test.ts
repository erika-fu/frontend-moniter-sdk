import { afterEach, describe, expect, it, vi } from "vitest";

const { report } = vi.hoisted(() => ({
  report: vi.fn(() => true),
}));

vi.mock("../src/report.js", () => ({
  report,
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
    report.mockClear();
  });

  it("sends behavior, runtime error, and performance data through report", () => {
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

    expect(report).toHaveBeenCalledTimes(3);
    expect(report).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "behavior", subType: "pv" }),
    );
    expect(report).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "error", subType: "js" }),
    );
    expect(report).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: "performance", subType: "load" }),
    );
    expect(onReport).toHaveBeenCalledTimes(3);
  });
});
