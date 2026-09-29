import { describe, expect, it } from "vitest";
import { SDK_NAME } from "../src/index.js";

describe("SDK entry point", () => {
  it("exports the package name", () => {
    expect(SDK_NAME).toBe("frontend-moniter-sdk");
  });
});
