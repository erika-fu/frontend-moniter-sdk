import { ref, shallowRef } from "vue";
import {
    SourceMapConsumer,
    type RawSourceMap,
} from "source-map-js";

export interface StackFrame {
    raw: string;
    functionName?: string;
    fileName: string;
    lineNumber: number;
    columnNumber: number;
}

export interface ResolvedStackFrame extends StackFrame {
    originalFileName?: string;
    originalLineNumber?: number;
    originalColumnNumber?: number;
    originalName?: string;
    sourceContent?: string;
}

export const sourceMapFileName = ref("");
export const sourceMapError = ref("");
const sourceMapConsumer = shallowRef<SourceMapConsumer>();

function parseStackLine(line: string): StackFrame | undefined {
    const raw = line.trim();
    if (!raw) {
        return undefined;
    }

    let location = raw;
    let functionName: string | undefined;

    if (location.startsWith("at ")) {
        location = location.slice(3).trim();
    }

    const parenthesisIndex = location.lastIndexOf(" (");
    if (parenthesisIndex >= 0 && location.endsWith(")")) {
        functionName = location.slice(0, parenthesisIndex).trim() || undefined;
        location = location.slice(parenthesisIndex + 2, -1);
    } else {
        const atIndex = location.lastIndexOf("@");
        if (atIndex >= 0) {
            functionName = location.slice(0, atIndex).trim() || undefined;
            location = location.slice(atIndex + 1);
        }
    }

    const position = location.match(/^(.*):(\d+):(\d+)$/);
    if (!position) {
        return undefined;
    }

    const [, fileName, lineNumber, columnNumber] = position;
    if (!fileName || !lineNumber || !columnNumber) {
        return undefined;
    }

    return {
        raw,
        ...(functionName ? { functionName } : {}),
        fileName,
        lineNumber: Number(lineNumber),
        columnNumber: Number(columnNumber),
    };
}

export function parseStack(stack: string): StackFrame[] {
    return stack
        .split("\n")
        .map(parseStackLine)
        .filter((frame): frame is StackFrame => frame !== undefined);
}

function getSourceContent(
    consumer: SourceMapConsumer,
    source: string,
): string | undefined {
    try {
        return consumer.sourceContentFor(source, true) ?? undefined;
    } catch {
        return undefined;
    }
}

function getFileName(value: string): string {
    return value
        .split(/[?#]/, 1)[0]!
        .split("/")
        .pop() ?? value;
}

function normalizeSourcePath(value: string): string {
    return value
        .split(/[?#]/, 1)[0]!
        .replaceAll("\\", "/")
        .replace(/^(\.\.\/)+/, "")
        .replace(/^\.\//, "")
        .replace(/^\/+/, "");
}

function findOriginalSource(
    frame: StackFrame,
    consumer: SourceMapConsumer,
): string | undefined {
    const framePath = normalizeSourcePath(frame.fileName);
    return consumer.sources.find((source) => {
        const sourcePath = normalizeSourcePath(source);
        return (
            framePath === sourcePath ||
            framePath.endsWith(`/${sourcePath}`) ||
            sourcePath.endsWith(`/${framePath}`)
        );
    });
}

function mapMatchesFrame(
    frame: StackFrame,
    consumer: SourceMapConsumer,
): boolean {
    if (consumer.file) {
        const frameFileName = getFileName(frame.fileName);
        const mapFileName = getFileName(consumer.file);
        if (
            frameFileName === mapFileName ||
            frameFileName.endsWith(mapFileName) ||
            mapFileName.endsWith(frameFileName)
        ) {
            return true;
        }
    }

    // Dev server 堆栈可能已经指向 map 中的原始 source，而不是 generated file。
    return findOriginalSource(frame, consumer) !== undefined;
}

export function resolveStackWithMap(
    stack: string,
    consumer: SourceMapConsumer | undefined,
): ResolvedStackFrame[] {
    return parseStack(stack).map((frame) => {
        if (!consumer || !mapMatchesFrame(frame, consumer)) {
            return frame;
        }

        const originalSource = findOriginalSource(frame, consumer);
        if (originalSource) {
            const sourceContent = getSourceContent(consumer, originalSource);
            return {
                ...frame,
                originalFileName: originalSource,
                originalLineNumber: frame.lineNumber,
                originalColumnNumber: frame.columnNumber,
                ...(sourceContent !== undefined ? { sourceContent } : {}),
            };
        }

        try {
            const position = consumer.originalPositionFor({
                line: frame.lineNumber,
                column: Math.max(0, frame.columnNumber - 1),
                bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
            });
            if (!position.source || position.line === null) {
                return frame;
            }

            const sourceContent = getSourceContent(consumer, position.source);
            return {
                ...frame,
                originalFileName: position.source,
                originalLineNumber: position.line,
                ...(position.column !== null
                    ? { originalColumnNumber: position.column + 1 }
                    : {}),
                ...(position.name ? { originalName: position.name } : {}),
                ...(sourceContent !== undefined ? { sourceContent } : {}),
            };
        } catch {
            return frame;
        }
    });
}

export function resolveStack(stack: string): ResolvedStackFrame[] {
    return resolveStackWithMap(stack, sourceMapConsumer.value);
}

function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
            } else {
                reject(new Error("无法读取 SourceMap 文件"));
            }
        });
        reader.addEventListener("error", () => {
            reject(new Error("无法读取 SourceMap 文件"));
        });
        reader.readAsText(file);
    });
}

export async function loadSourceMap(file: File): Promise<void> {
    sourceMapError.value = "";

    try {
        const rawMap = JSON.parse(await readFile(file)) as RawSourceMap;
        if (
            rawMap.version === undefined ||
            !Array.isArray(rawMap.sources) ||
            typeof rawMap.mappings !== "string"
        ) {
            throw new Error("文件不是有效的 SourceMap");
        }

        sourceMapConsumer.value = new SourceMapConsumer(rawMap);
        sourceMapFileName.value = file.name;
    } catch (error) {
        sourceMapConsumer.value = undefined;
        sourceMapFileName.value = "";
        sourceMapError.value =
            error instanceof Error ? error.message : "SourceMap 解析失败";
    }
}

export function clearSourceMap(): void {
    sourceMapConsumer.value = undefined;
    sourceMapFileName.value = "";
    sourceMapError.value = "";
}
