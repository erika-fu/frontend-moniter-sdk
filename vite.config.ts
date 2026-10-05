import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const isIifeBuild = mode === "iife";

  return {
    test: {
      exclude: [...configDefaults.exclude, "react-demo/**"],
    },
    build: {
      emptyOutDir: !isIifeBuild,
      lib: {
        entry: resolve(__dirname, "src/index.ts"),
        name: "FrontendMonitor",
        formats: isIifeBuild ? ["iife"] : ["es", "cjs"],
        fileName: (format) => {
          if (format === "cjs") {
            return "index.cjs";
          }
          if (format === "iife") {
            return "index.iife.js";
          }
          return "index.js";
        },
      },
      minify: "esbuild",
      sourcemap: false,
      rollupOptions: {
        external: isIifeBuild ? [] : ["web-vitals"],
        output: {
          exports: "named",
        },
      },
    },
  };
});
