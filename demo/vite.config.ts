import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
    plugins: [vue()],
    server: {
        fs: {
            allow: [repositoryRoot],
        },
    },
});
