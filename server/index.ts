import {
    createServer,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

export interface ReportServerOptions {
    logger?: ((report: unknown) => void) | undefined;
}

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks).toString("utf8");
    const contentType = request.headers["content-type"] ?? "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(body));
    }

    return parseJson(body);
}

function send(
    response: ServerResponse,
    statusCode: number,
    body = "",
): void {
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(body);
}

export function createReportServer(
    options: ReportServerOptions = {},
): Server {
    const logger = options.logger ?? console.log;

    return createServer(async (request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");

        if (request.method === "OPTIONS") {
            send(response, 204);
            return;
        }

        if (url.pathname !== "/reportData") {
            send(response, 404, "Not Found");
            return;
        }

        if (request.method === "GET") {
            const data = url.searchParams.get("data");
            logger(data === null ? null : parseJson(data));
            send(response, 200, "ok");
            return;
        }

        if (request.method === "POST") {
            logger(await readRequestBody(request));
            send(response, 200, "ok");
            return;
        }

        send(response, 405, "Method Not Allowed");
    });
}

const entryPath = process.argv[1];
if (
    entryPath !== undefined &&
    import.meta.url === pathToFileURL(entryPath).href
) {
    const port = Number.parseInt(process.env.PORT ?? "9800", 10);
    const server = createReportServer();

    server.listen(port, () => {
        console.log(`server is running on ${port}`);
    });
}
