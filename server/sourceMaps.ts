import { SourceMapConsumer } from "source-map-js";

export type SourceMapResolutionStatus =
    | "resolved"
    | "version_not_found"
    | "file_not_found"
    | "parse_failed"
    | "unmapped";

export interface SourceMapRecord {
    appId: string;
    release: string;
    generatedFile: string;
    sourceMap: unknown;
}

export interface ResolvedStack {
    stackFrames: Array<Record<string, unknown>>;
    resolutionStatus: SourceMapResolutionStatus;
}

type StackFrame = Record<string, unknown>;

function normalizeFile(value: string): string {
    try {
        return new URL(value).pathname;
    } catch {
        return value.split(/[?#]/, 1)[0] ?? value;
    }
}

function sameGeneratedFile(left: string, right: string): boolean {
    const normalizedLeft = normalizeFile(left);
    const normalizedRight = normalizeFile(right);
    return normalizedLeft === normalizedRight ||
        normalizedLeft.endsWith(`/${normalizedRight}`) ||
        normalizedRight.endsWith(`/${normalizedLeft}`);
}

export function isSourceMap(value: unknown): value is {
    version: number;
    sources: unknown[];
    names: unknown[];
    mappings: string;
} {
    return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        (value as { version?: unknown }).version === 3 &&
        Array.isArray((value as { sources?: unknown }).sources) &&
        Array.isArray((value as { names?: unknown }).names) &&
        typeof (value as { mappings?: unknown }).mappings === "string";
}

export function isParseableSourceMap(value: unknown): boolean {
    if (!isSourceMap(value)) return false;
    try {
        const consumer = new SourceMapConsumer({
            ...value,
            version: String(value.version),
            sources: value.sources.filter(
                (source): source is string => typeof source === "string",
            ),
            names: value.names.filter(
                (name): name is string => typeof name === "string",
            ),
        });
        consumer.originalPositionFor({ line: 1, column: 0 });
        return true;
    } catch {
        return false;
    }
}

export function resolveStack(
    stack: string,
    appId: string,
    release: string,
    maps: SourceMapRecord[],
): ResolvedStack {
    const frames = stack.split(/\r?\n/).map((line) => {
        const match = line.match(
            /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/,
        );
        if (!match || !match[2] || !match[3] || !match[4]) return undefined;
        return {
            functionName: match[1] || undefined,
            fileName: match[2],
            lineNumber: Number(match[3]),
            columnNumber: Number(match[4]),
        } as StackFrame;
    }).filter((frame): frame is StackFrame => frame !== undefined);
    const releaseMaps = maps.filter(
        (map) => map.appId === appId && map.release === release,
    );
    if (releaseMaps.length === 0) {
        return { stackFrames: frames, resolutionStatus: "version_not_found" };
    }

    let foundFile = false;
    let foundMapping = false;
    let parseFailed = false;
    const resolved = frames.map((frame) => {
        if (typeof frame.fileName !== "string" ||
            typeof frame.lineNumber !== "number" ||
            typeof frame.columnNumber !== "number") {
            return frame;
        }
        const fileName = frame.fileName;
        const lineNumber = frame.lineNumber;
        const columnNumber = frame.columnNumber;
        const map = releaseMaps.find((candidate) =>
            sameGeneratedFile(candidate.generatedFile, fileName)
        );
        if (!map) return frame;
        foundFile = true;
        try {
            if (!isSourceMap(map.sourceMap)) {
                parseFailed = true;
                return frame;
            }
            const consumer = new SourceMapConsumer({
                ...map.sourceMap,
                version: String(map.sourceMap.version),
                sources: map.sourceMap.sources.filter(
                    (source): source is string => typeof source === "string",
                ),
                names: map.sourceMap.names.filter(
                    (name): name is string => typeof name === "string",
                ),
            });
            const original = consumer.originalPositionFor({
                line: lineNumber,
                column: Math.max(0, columnNumber - 1),
            });
            if (!original.source || original.line === null || original.column === null) {
                return frame;
            }
            foundMapping = true;
            return {
                ...frame,
                originalFileName: original.source,
                originalLineNumber: original.line,
                originalColumnNumber: original.column + 1,
            };
        } catch {
            parseFailed = true;
            return frame;
        }
    });

    return {
        stackFrames: resolved,
        resolutionStatus: parseFailed
            ? "parse_failed"
            : foundMapping
            ? "resolved"
            : foundFile
            ? "unmapped"
            : "file_not_found",
    };
}
