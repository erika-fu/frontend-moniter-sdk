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
