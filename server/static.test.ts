import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    demoSourceMapUrl,
    resolveStaticPath,
} from "./static.js";

describe("resolveStaticPath", () => {
    const roots: string[] = [];

    afterEach(() => {
        roots.length = 0;
    });

    function fixture(): string {
        const root = mkdtempSync(join(tmpdir(), "moniter-static-"));
        roots.push(root);
        mkdirSync(join(root, "demo", "assets"), { recursive: true });
        mkdirSync(join(root, "platform", "assets"), { recursive: true });
        writeFileSync(join(root, "demo", "index.html"), "<demo/>");
        writeFileSync(join(root, "demo", "assets", "app.js"), "demo");
        writeFileSync(join(root, "platform", "index.html"), "<platform/>");
        writeFileSync(join(root, "platform", "assets", "app.js"), "platform");
        return root;
    }

    it("serves demo index at /", () => {
        const root = fixture();
        expect(resolveStaticPath(root, "/")).toBe(join(root, "demo", "index.html"));
    });

    it("serves demo assets", () => {
        const root = fixture();
        expect(resolveStaticPath(root, "/assets/app.js")).toBe(
            join(root, "demo", "assets", "app.js"),
        );
    });

    it("serves platform under /platform/", () => {
        const root = fixture();
        expect(resolveStaticPath(root, "/platform/")).toBe(
            join(root, "platform", "index.html"),
        );
        expect(resolveStaticPath(root, "/platform/assets/app.js")).toBe(
            join(root, "platform", "assets", "app.js"),
        );
    });

    it("falls back to platform index for client routes", () => {
        const root = fixture();
        expect(resolveStaticPath(root, "/platform/errors")).toBe(
            join(root, "platform", "index.html"),
        );
    });

    it("rejects path traversal", () => {
        const root = fixture();
        expect(resolveStaticPath(root, "/../package.json")).toBeUndefined();
        expect(resolveStaticPath(root, "/platform/../../package.json")).toBeUndefined();
    });
});

describe("demoSourceMapUrl", () => {
    it("appends .map for configured demo origins", () => {
        expect(
            demoSourceMapUrl("https://frontend-moniter-demo.fly.dev/assets/a.js", [
                "https://frontend-moniter-demo.fly.dev",
            ]),
        ).toBe("https://frontend-moniter-demo.fly.dev/assets/a.js.map");
    });

    it("ignores unrelated origins", () => {
        expect(
            demoSourceMapUrl("https://evil.example/assets/a.js", [
                "http://localhost:4173",
            ]),
        ).toBeUndefined();
    });
});
