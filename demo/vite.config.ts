import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    build: {
        sourcemap: true,
    },
    server: {
        fs: {
            allow: [repositoryRoot],
        },
    },
});
