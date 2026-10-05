import ErrorStackParser from "error-stack-parser";
import { SourceMapConsumer } from "source-map-js";

export interface ParsedStackFrame {
    functionName?: string;
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
}

export interface SourceStackFrame extends ParsedStackFrame {
    originalFileName?: string;
    originalLineNumber?: number;
    originalColumnNumber?: number;
}

export interface StackResolutionOptions {
    sourceMapUrl?:
        | ((fileUrl: string, release?: string) => string | undefined)
        | undefined;
}

function getStack(error: unknown): string | undefined {
    return typeof error === "object" &&
        error !== null &&
        "stack" in error &&
        typeof (error as { stack?: unknown }).stack === "string"
        ? (error as { stack: string }).stack
        : undefined;
}

function parseStack(stack: string): ParsedStackFrame[] {
    try {
        const error = new Error();
        error.stack = stack;
        return ErrorStackParser.parse(error).map((frame) => ({
            ...(frame.functionName
                ? { functionName: frame.functionName }
                : {}),
            ...(frame.fileName ? { fileName: frame.fileName } : {}),
            ...(frame.lineNumber !== undefined
                ? { lineNumber: frame.lineNumber }
                : {}),
            ...(frame.columnNumber !== undefined
                ? { columnNumber: frame.columnNumber }
                : {}),
        }));
    } catch {
        return [];
    }
}

function getSourceMapUrl(
    fileUrl: string,
    release: string | undefined,
    options: StackResolutionOptions,
): string | undefined {
    return options.sourceMapUrl?.(fileUrl, release);
}

async function resolveFrame(
    frame: ParsedStackFrame,
    release: string | undefined,
    options: StackResolutionOptions,
): Promise<SourceStackFrame> {
    if (
        !frame.fileName ||
        frame.lineNumber === undefined ||
        frame.columnNumber === undefined
    ) {
        return frame;
    }

    const mapUrl = getSourceMapUrl(frame.fileName, release, options);
    if (!mapUrl) {
        return frame;
    }

    try {
        const response = await fetch(mapUrl);
        if (!response.ok) {
            return frame;
        }
        const consumer = new SourceMapConsumer(await response.json());
        const original = consumer.originalPositionFor({
            line: frame.lineNumber,
            column: Math.max(0, frame.columnNumber - 1),
        });
        if (!original.source || original.line === null || original.column === null) {
            return frame;
        }

        return {
            ...frame,
            originalFileName: new URL(original.source, mapUrl).href,
            originalLineNumber: original.line,
            originalColumnNumber: original.column + 1,
        };
    } catch {
        return frame;
    }
}

export async function resolveErrorStack(
    report: unknown,
    options: StackResolutionOptions = {},
): Promise<unknown> {
    if (!report || typeof report !== "object") {
        return report;
    }

    const stack = getStack(report);
    if (!stack) {
        return report;
    }

    const stackFrames = parseStack(stack);
    const release =
        "release" in report && typeof report.release === "string"
            ? report.release
            : undefined;
    const sourceStack = await Promise.all(
        stackFrames.map((frame) => resolveFrame(frame, release, options)),
    );

    return {
        ...report,
        stackFrames,
        sourceStack,
    };
}
