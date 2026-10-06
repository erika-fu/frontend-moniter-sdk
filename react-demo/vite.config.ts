import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: [
            {
                find: /^web-vitals$/,
                replacement: fileURLToPath(
                    new URL(
                        "../node_modules/web-vitals/dist/web-vitals.js",
                        import.meta.url,
                    ),
                ),
            },
        ],
    },
    server: {
        fs: {
            allow: [repositoryRoot],
        },
    },
});
