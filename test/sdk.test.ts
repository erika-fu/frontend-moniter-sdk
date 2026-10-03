import {
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import type { PerformanceMonitoringOptions } from "../src/performance/index.js";

const {
  observeError,
  observePerformance,
  setFrameworkErrorReportHandler,
} = vi.hoisted(() => ({
  observeError: vi.fn(),
  observePerformance: vi.fn(),
  setFrameworkErrorReportHandler: vi.fn(),
}));

vi.mock("../src/error/index.js", () => ({
  errorBoundary: vi.fn(),
  install: vi.fn(),
  observeError,
}));
vi.mock("../src/error/framework.js", () => ({
  setFrameworkErrorReportHandler,
}));
vi.mock("../src/performance/index.js", () => ({
  observePerformance,
}));

import sdk, { init, type SDKOptions } from "../src/index.js";

type SDKPerformanceOptions = Exclude<
  SDKOptions["performance"],
  false | undefined
>;

describe("SDK initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts performance and runtime error monitoring by default", () => {
    const onReport = vi.fn();

    init({ onReport });

    expect(setFrameworkErrorReportHandler).toHaveBeenCalledWith(onReport);
    expect(observePerformance).toHaveBeenCalledWith({ onReport });
    expect(observeError).toHaveBeenCalledWith(onReport);
  });

  it("reuses the performance module configuration type", () => {
    expectTypeOf<SDKPerformanceOptions>().toEqualTypeOf<
      Omit<PerformanceMonitoringOptions, "onReport">
    >();
    expectTypeOf<
      true extends SDKOptions["performance"] ? true : false
    >().toEqualTypeOf<false>();
  });

  it("supports selecting performance monitors and disabling runtime errors", () => {
    const onReport = vi.fn();

    init({
      onReport,
      performance: { monitors: ["fcp", "lcp"] },
      error: false,
    });

    expect(observePerformance).toHaveBeenCalledWith({
      monitors: ["fcp", "lcp"],
      onReport,
    });
    expect(observeError).not.toHaveBeenCalled();
  });

  it("ignores a module report handler carried by a typed variable", () => {
    const moduleReport = vi.fn();
    const performanceOptions: PerformanceMonitoringOptions = {
      monitors: ["fcp"],
      onReport: moduleReport,
    };

    init({ performance: performanceOptions });

    expect(observePerformance).toHaveBeenCalledWith({
      monitors: ["fcp"],
    });
  });

  it("can disable performance monitoring", () => {
    init({ performance: false });

    expect(observePerformance).not.toHaveBeenCalled();
    expect(observeError).toHaveBeenCalledWith(undefined);
  });

  it("provides the main APIs on the default export", () => {
    expect(sdk.init).toBe(init);
    expect(sdk.performance).toBe(observePerformance);
    expect(sdk.error).toBe(observeError);
    expect(sdk.observePerformance).toBe(observePerformance);
    expect(sdk.observeError).toBe(observeError);
    expect(sdk.install).toBeTypeOf("function");
    expect(sdk.errorBoundary).toBeTypeOf("function");
  });
});
