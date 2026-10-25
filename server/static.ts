import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

function isInsideRoot(root: string, candidate: string): boolean {
    const resolvedRoot = resolve(root);
    const resolvedCandidate = resolve(candidate);
    return (
        resolvedCandidate === resolvedRoot ||
        resolvedCandidate.startsWith(resolvedRoot + sep)
    );
}

function safeJoin(root: string, relativePath: string): string | undefined {
    const normalized = normalize(relativePath).replace(/^([/\\])+/, "");
    if (normalized.includes("..")) return undefined;
    const candidate = join(root, normalized);
    if (!isInsideRoot(root, candidate)) return undefined;
    return candidate;
}

/** Map a request pathname to a file under staticRoot (demo/ + platform/). */
export function resolveStaticPath(
    staticRoot: string,
    pathname: string,
): string | undefined {
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathname);
    } catch {
        return undefined;
    }
    if (decoded.includes("\0")) return undefined;

    let relative: string;
    let spaFallback: string | undefined;

    if (decoded === "/" || decoded === "") {
        relative = "demo/index.html";
    } else if (decoded === "/platform" || decoded === "/platform/") {
        relative = "platform/index.html";
    } else if (decoded.startsWith("/platform/")) {
        relative = `platform/${decoded.slice("/platform/".length)}`;
        spaFallback = "platform/index.html";
    } else {
        relative = `demo/${decoded.slice(1)}`;
        spaFallback = "demo/index.html";
    }

    const direct = safeJoin(staticRoot, relative);
    if (direct && existsSync(direct) && statSync(direct).isFile()) {
        return direct;
    }

    if (direct && existsSync(direct) && statSync(direct).isDirectory()) {
        const indexPath = join(direct, "index.html");
        if (existsSync(indexPath) && statSync(indexPath).isFile()) {
            return indexPath;
        }
    }

    // SPA-style fallback only when the path looks like a client route (no file extension).
    if (spaFallback && !extname(decoded)) {
        const fallback = safeJoin(staticRoot, spaFallback);
        if (fallback && existsSync(fallback) && statSync(fallback).isFile()) {
            return fallback;
        }
    }

    return undefined;
}

export function contentTypeFor(filePath: string): string {
    return MIME_TYPES[extname(filePath).toLowerCase()] ??
        "application/octet-stream";
}

export function tryServeStatic(
    request: IncomingMessage,
    response: ServerResponse,
    staticRoot: string,
    pathname: string,
    headers: Record<string, string> = {},
): boolean {
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") return false;

    const filePath = resolveStaticPath(staticRoot, pathname);
    if (!filePath) return false;

    const type = contentTypeFor(filePath);
    const size = statSync(filePath).size;
    response.writeHead(200, {
        ...headers,
        "Content-Type": type,
        "Content-Length": String(size),
    });

    if (method === "HEAD") {
        response.end();
        return true;
    }

    createReadStream(filePath).pipe(response);
    return true;
}

/** Origins whose script URLs may have colocated `.map` files fetched for stack resolution. */
export function demoSourceMapUrl(
    fileUrl: string,
    origins = configuredDemoOrigins(),
): string | undefined {
    const normalized = origins.map((origin) => origin.replace(/\/$/, ""));
    if (normalized.some((origin) => fileUrl.startsWith(`${origin}/`))) {
        return `${fileUrl}.map`;
    }
    return undefined;
}

export function configuredDemoOrigins(): string[] {
    return (process.env.DEMO_ORIGINS ?? "http://localhost:4173")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}
