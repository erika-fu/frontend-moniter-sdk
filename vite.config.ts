import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: "index",
    },
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      external: ["web-vitals"],
    },
  },
});
