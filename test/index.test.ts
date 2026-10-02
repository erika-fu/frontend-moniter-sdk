import { describe, expect, it } from "vitest";
import {
  observeFetch,
  observePerformance,
  observeXHR,
  SDK_NAME,
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
});
