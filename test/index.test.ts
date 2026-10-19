import { describe, expect, it } from "vitest";
import {
  errorBoundary,
  init,
  install,
  observeBehavior,
  observeClick,
  observeError,
  observeFetch,
  observePerformance,
  observeXHR,
  report,
  SDK_NAME,
  setConfig,
  subscribe,
  type BehaviorMonitoringOptions,
  type ClickMonitoringOptions,
  type ClickReportData,
} from "../src/index.js";

describe("SDK entry point", () => {
  it("exports the package name", () => {
    expect(SDK_NAME).toBe("frontend-moniter-sdk");
  });

  it("re-exports the performance monitoring API", () => {
    expect(observePerformance).toBeTypeOf("function");
    expect(observeFetch).toBeTypeOf("function");
    expect(observeXHR).toBeTypeOf("function");
  });

  it("re-exports the behavior monitoring API", () => {
    expect(observeBehavior).toBeTypeOf("function");
    expect(observeClick).toBeTypeOf("function");

    const clickOptions = {
      clickAttributes: ["data-track"],
    } satisfies ClickMonitoringOptions;
    const behaviorOptions = {
      clickAttributes: ["data-track"],
    } satisfies BehaviorMonitoringOptions;
    const clickReport = {
      type: "behavior",
      subType: "click",
      target: "BUTTON",
      startTime: 1,
      width: 1,
      height: 1,
      eventType: "click",
      attributes: { "data-track": "buy" },
    } satisfies ClickReportData;

    expect(clickOptions.clickAttributes).toEqual(["data-track"]);
    expect(behaviorOptions.clickAttributes).toEqual(["data-track"]);
    expect(clickReport).not.toHaveProperty("innerHtml");
  });

  it("exports the SDK and framework error APIs", () => {
    expect(init).toBeTypeOf("function");
    expect(observeError).toBeTypeOf("function");
    expect(install).toBeTypeOf("function");
    expect(errorBoundary).toBeTypeOf("function");
    expect(report).toBeTypeOf("function");
    expect(setConfig).toBeTypeOf("function");
    expect(subscribe).toBeTypeOf("function");
  });
});
