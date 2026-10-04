import {
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import type { BehaviorMonitoringOptions } from "../src/behavior/index.js";
import type { PerformanceMonitoringOptions } from "../src/performance/index.js";

const {
  configureReportHandler,
  observeBehavior,
  observeError,
  observePerformance,
  setFrameworkErrorReportHandler,
} = vi.hoisted(() => ({
  configureReportHandler: vi.fn((options) => options.onReport),
  observeBehavior: vi.fn(),
  observeError: vi.fn(),
  observePerformance: vi.fn(),
  setFrameworkErrorReportHandler: vi.fn(),
}));

vi.mock("../src/behavior/index.js", () => ({
  observeBehavior,
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
vi.mock("../src/report.js", () => ({
  configureReportHandler,
}));

import sdk, { init, type SDKOptions } from "../src/index.js";

type SDKPerformanceOptions = Exclude<
  SDKOptions["performance"],
  false | undefined
>;
type SDKBehaviorOptions = Exclude<
  SDKOptions["behavior"],
  false | undefined
>;

describe("SDK initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureReportHandler.mockImplementation((options) => options.onReport);
  });

  it("starts behavior, performance, and runtime error monitoring by default", () => {
    const onReport = vi.fn();

    init({ onReport });

    expect(configureReportHandler).toHaveBeenCalledWith({ onReport });
    expect(setFrameworkErrorReportHandler).toHaveBeenCalledWith(onReport);
    expect(observeBehavior).toHaveBeenCalledWith({ onReport });
    expect(observePerformance).toHaveBeenCalledWith({ onReport });
    expect(observeError).toHaveBeenCalledWith(onReport);
  });

  it("configures built-in reporting and gives every monitor its handler", () => {
    const reportHandler = vi.fn();
    configureReportHandler.mockReturnValue(reportHandler);

    init({
      url: "/monitor",
      appId: "web",
      batchSize: 10,
    });

    expect(configureReportHandler).toHaveBeenCalledWith({
      url: "/monitor",
      appId: "web",
      batchSize: 10,
    });
    expect(setFrameworkErrorReportHandler).toHaveBeenCalledWith(reportHandler);
    expect(observeBehavior).toHaveBeenCalledWith({
      onReport: reportHandler,
    });
    expect(observePerformance).toHaveBeenCalledWith({
      onReport: reportHandler,
    });
    expect(observeError).toHaveBeenCalledWith(reportHandler);
  });

  it("reuses the module configuration types", () => {
    expectTypeOf<SDKPerformanceOptions>().toEqualTypeOf<
      Omit<PerformanceMonitoringOptions, "onReport">
    >();
    expectTypeOf<
      true extends SDKOptions["performance"] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<SDKBehaviorOptions>().toEqualTypeOf<
      Omit<BehaviorMonitoringOptions, "onReport">
    >();
    expectTypeOf<
      true extends SDKOptions["behavior"] ? true : false
    >().toEqualTypeOf<false>();
  });

  it("supports selecting behavior and performance monitors", () => {
    const onReport = vi.fn();

    init({
      onReport,
      behavior: { monitors: ["pv"] },
      performance: { monitors: ["fcp", "lcp"] },
      error: false,
    });

    expect(observeBehavior).toHaveBeenCalledWith({
      monitors: ["pv"],
      onReport,
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
    init({ behavior: false, performance: false });

    expect(observeBehavior).not.toHaveBeenCalled();
    expect(observePerformance).not.toHaveBeenCalled();
    expect(observeError).toHaveBeenCalledWith(undefined);
  });

  it("provides the main APIs on the default export", () => {
    expect(sdk.init).toBe(init);
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
