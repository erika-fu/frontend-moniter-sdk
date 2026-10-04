import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isIifeBuild = mode === "iife";

  return {
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
