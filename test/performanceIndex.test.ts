import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  observeFCP,
  observeFetch,
  observeLCP,
  observeLoad,
  observePaint,
  observeResources,
  observeXHR,
} = vi.hoisted(() => ({
  observeFCP: vi.fn(),
  observeFetch: vi.fn(),
  observeLCP: vi.fn(),
  observeLoad: vi.fn(),
  observePaint: vi.fn(),
  observeResources: vi.fn(),
  observeXHR: vi.fn(),
}));

vi.mock("../src/performance/observeFCP.js", () => ({ observeFCP }));
vi.mock("../src/performance/observeFetch.js", () => ({ observeFetch }));
vi.mock("../src/performance/observeLCP.js", () => ({ observeLCP }));
vi.mock("../src/performance/observeLoad.js", () => ({ observeLoad }));
vi.mock("../src/performance/observePaint.js", () => ({ observePaint }));
vi.mock("../src/performance/observeResources.js", () => ({
  observeResources,
}));
vi.mock("../src/performance/observeXHR.js", () => ({ observeXHR }));

import observePerformance, {
  observePerformance as namedObservePerformance,
} from "../src/performance/index.js";

describe("performance entry point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts every performance observer", () => {
    observePerformance();

    expect(observeFetch).toHaveBeenCalledWith(undefined);
    expect(observeResources).toHaveBeenCalledWith(undefined);
    expect(observeLCP).toHaveBeenCalledWith(undefined);
    expect(observeFCP).toHaveBeenCalledWith(undefined);
    expect(observeLoad).toHaveBeenCalledWith(undefined);
    expect(observePaint).toHaveBeenCalledWith(undefined);
    expect(observeXHR).toHaveBeenCalledWith(undefined);
  });

  it("starts only the configured monitors", () => {
    const onReport = vi.fn();

    namedObservePerformance({
      monitors: ["fcp", "lcp", "xhr"],
      onReport,
    });

    expect(observeFCP).toHaveBeenCalledWith(onReport);
    expect(observeLCP).toHaveBeenCalledWith(onReport);
    expect(observeXHR).toHaveBeenCalledWith(onReport);
    expect(observeFetch).not.toHaveBeenCalled();
    expect(observeResources).not.toHaveBeenCalled();
    expect(observeLoad).not.toHaveBeenCalled();
    expect(observePaint).not.toHaveBeenCalled();
  });

});
