import { describe, expect, it } from "vitest";
import {
    SourceMapGenerator,
    SourceMapConsumer,
} from "source-map-js";
import {
    parseStack,
    resolveStackWithMap,
} from "../demo/src/sourceMapStore.js";

describe("demo SourceMap resolver", () => {
    it("parses browser stack locations", () => {
        expect(
            parseStack(
                "Error: failed\n" +
                    "    at loadData (https://demo.test/assets/app.js:8:14)\n" +
                    "render@https://demo.test/assets/app.js:3:2",
            ),
        ).toEqual([
            {
                raw: "at loadData (https://demo.test/assets/app.js:8:14)",
                functionName: "loadData",
                fileName: "https://demo.test/assets/app.js",
                lineNumber: 8,
                columnNumber: 14,
            },
            {
                raw: "render@https://demo.test/assets/app.js:3:2",
                functionName: "render",
                fileName: "https://demo.test/assets/app.js",
                lineNumber: 3,
                columnNumber: 2,
            },
        ]);
    });

    it("maps matching generated files and keeps unrelated frames unchanged", () => {
        const generator = new SourceMapGenerator({ file: "assets/app.js" });
        generator.setSourceContent("src/main.ts", "const answer = 42;");
        generator.addMapping({
            generated: { line: 1, column: 0 },
            original: { line: 1, column: 0 },
            source: "src/main.ts",
            name: "answer",
        });
        const consumer = new SourceMapConsumer(
            generator.toJSON() as unknown as ConstructorParameters<
                typeof SourceMapConsumer
            >[0],
        );

        const [mapped, unrelated] = resolveStackWithMap(
            "Error\n" +
                "    at run (https://demo.test/assets/app.js:1:1)\n" +
                "    at vendor (https://demo.test/assets/vendor.js:1:1)",
            consumer,
        );

        expect(mapped).toMatchObject({
            originalFileName: "src/main.ts",
            originalLineNumber: 1,
            originalColumnNumber: 1,
            originalName: "answer",
            sourceContent: "const answer = 42;",
        });
        expect(unrelated).not.toHaveProperty("originalFileName");
    });

    it("recognizes a dev-server source path already present in the map", () => {
        const generator = new SourceMapGenerator({ file: "assets/app.js" });
        generator.setSourceContent(
            "src/views/DashboardView.vue",
            "<script setup>throw new Error()</script>",
        );
        generator.addMapping({
            generated: { line: 1, column: 0 },
            original: { line: 1, column: 0 },
            source: "src/views/DashboardView.vue",
        });
        const consumer = new SourceMapConsumer(
            generator.toJSON() as unknown as ConstructorParameters<
                typeof SourceMapConsumer
            >[0],
        );

        const [frame] = resolveStackWithMap(
            "Error\n" +
                "    at throwJavaScriptError (http://localhost:4174/src/views/DashboardView.vue:32:15)",
            consumer,
        );

        expect(frame).toMatchObject({
            originalFileName: "src/views/DashboardView.vue",
            originalLineNumber: 32,
            originalColumnNumber: 15,
            sourceContent: "<script setup>throw new Error()</script>",
        });
    });
});
