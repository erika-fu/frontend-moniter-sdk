import { beforeEach, describe, expect, it, vi } from "vitest";

const { setConfig, observeBehavior, observeError, observePerformance } =
  vi.hoisted(() => ({
    setConfig: vi.fn(),
    observeBehavior: vi.fn(),
    observeError: vi.fn(),
    observePerformance: vi.fn(),
  }));

vi.mock("../src/behavior/index.js", () => ({
  observeBehavior,
}));
vi.mock("../src/error/index.js", () => ({
  errorBoundary: vi.fn(),
  install: vi.fn(),
  observeError,
}));
vi.mock("../src/performance/index.js", () => ({
  observePerformance,
}));
vi.mock("../src/report.js", () => ({
  setConfig,
}));

import sdk, { init } from "../src/index.js";

describe("SDK initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the default report configuration", () => {
    init({
      url: "/monitor",
      appId: "web",
      batchSize: 10,
    });

    expect(setConfig).toHaveBeenCalledWith({
      url: "/monitor",
      appId: "web",
      batchSize: 10,
    });
    expect(observeBehavior).not.toHaveBeenCalled();
    expect(observePerformance).not.toHaveBeenCalled();
    expect(observeError).not.toHaveBeenCalled();
  });

  it("accepts an empty configuration without starting monitors", () => {
    init();

    expect(setConfig).toHaveBeenCalledWith({});
    expect(observeBehavior).not.toHaveBeenCalled();
    expect(observePerformance).not.toHaveBeenCalled();
    expect(observeError).not.toHaveBeenCalled();
  });

  it("provides the main APIs on the default export", () => {
    expect(sdk.init).toBe(init);
    expect(sdk.subscribe).toBeTypeOf("function");
    expect(sdk.behavior).toBe(observeBehavior);
    expect(sdk.performance).toBe(observePerformance);
    expect(sdk.error).toBe(observeError);
    expect(sdk.observeBehavior).toBe(observeBehavior);
    expect(sdk.observePerformance).toBe(observePerformance);
    expect(sdk.observeError).toBe(observeError);
    expect(sdk.install).toBeTypeOf("function");
    expect(sdk.errorBoundary).toBeTypeOf("function");
  });
});
