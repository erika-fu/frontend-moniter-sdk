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
        };
    };
    files?: string[];
    main?: string;
    module?: string;
    types?: string;
};

describe("package distribution metadata", () => {
    it("exposes the ESM library entry and declarations", () => {
        expect(packageManifest.main).toBe("./dist/index.js");
        expect(packageManifest.module).toBe("./dist/index.js");
        expect(packageManifest.types).toBe("./dist/index.d.ts");
        expect(packageManifest.exports?.["."]).toEqual({
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
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
        expect(packageManifest.devDependencies).not.toHaveProperty(
            "vue-router",
        );
        expect(packageManifest.devDependencies).not.toHaveProperty("vue-tsc");
    });
});
