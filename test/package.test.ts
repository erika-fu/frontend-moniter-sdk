import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageManifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: {
    ".": {
      types: string;
      import: string;
      require: string;
      default: string;
    };
  };
  files?: string[];
  main?: string;
  module?: string;
  jsdelivr?: string;
  types?: string;
  unpkg?: string;
};

describe("package distribution metadata", () => {
  it("exposes ESM, CommonJS, IIFE, and declaration entries", () => {
    expect(packageManifest.main).toBe("./dist/index.cjs");
    expect(packageManifest.module).toBe("./dist/index.js");
    expect(packageManifest.types).toBe("./dist/index.d.ts");
    expect(packageManifest.unpkg).toBe("./dist/index.iife.js");
    expect(packageManifest.jsdelivr).toBe("./dist/index.iife.js");
    expect(packageManifest.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      require: "./dist/index.cjs",
      default: "./dist/index.js",
    });
  });

  it("publishes only the built distribution", () => {
    expect(packageManifest.files).toEqual(["dist"]);
    expect(packageManifest.dependencies).toMatchObject({
      "web-vitals": expect.any(String),
    });
  });

  it("keeps the Vue application tooling out of the SDK package", () => {
    expect(existsSync(new URL("../src/demo", import.meta.url))).toBe(false);
    expect(packageManifest.devDependencies).not.toHaveProperty(
      "@vitejs/plugin-vue",
    );
    expect(packageManifest.devDependencies).not.toHaveProperty("vue-router");
    expect(packageManifest.devDependencies).not.toHaveProperty("vue-tsc");
  });
});
