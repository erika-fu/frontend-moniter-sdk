import { describe, expect, it } from "vitest";
import {
  errorBoundary,
  init,
  install,
  observeError,
  observeFetch,
  observePerformance,
  observeXHR,
  report,
  SDK_NAME,
  setConfig,
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

  it("exports the SDK and framework error APIs", () => {
    expect(init).toBeTypeOf("function");
    expect(observeError).toBeTypeOf("function");
    expect(install).toBeTypeOf("function");
    expect(errorBoundary).toBeTypeOf("function");
    expect(report).toBeTypeOf("function");
    expect(setConfig).toBeTypeOf("function");
  });
});
