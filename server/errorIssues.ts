import { createHash } from "node:crypto";

export type ErrorStatus = "unresolved" | "resolved" | "ignored";

export interface ErrorIssueIdentity {
    fingerprint: string;
    message: string;
    stack: string;
}

function record(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null
        ? value as Record<string, unknown>
        : {};
}

function normalizeMessage(value: unknown): string {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b0x[0-9a-f]+\b/gi, "0x?")
        .replace(/\b\d{4,}\b/g, "?");
}

function firstStackFrame(value: unknown): string {
    const data = record(value);
    const source = Array.isArray(data.sourceStack)
        ? data.sourceStack
        : Array.isArray(data.stackFrames) ? data.stackFrames : [];
    const frame = record(source[0]);
    if (Object.keys(frame).length > 0) {
        const file = frame.originalFileName ?? frame.fileName ?? "";
        const line = frame.originalLineNumber ?? frame.lineNumber ?? "";
        const column = frame.originalColumnNumber ?? frame.columnNumber ?? "";
        const fn = frame.functionName ?? "";
        if (file || line || column || fn) {
            return [fn, file, line, column].filter(Boolean).join("@");
        }
    }
    const stack = typeof data.stack === "string" ? data.stack : "";
    return stack.split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !/^Error(?::|$)/.test(line)) ?? "";
}

export function getErrorIdentity(
    appId: string,
    data: unknown,
): ErrorIssueIdentity | undefined {
    const item = record(data);
    if (item.type !== "error" || typeof item.subType !== "string") {
        return undefined;
    }
    const message = normalizeMessage(
        item.msg ?? item.reason ?? item.error ?? item.url ?? item.message,
    );
    const stack = firstStackFrame(data);
    const identity = [appId, item.subType, message, stack].join("\u001f");
    return {
        fingerprint: createHash("sha256").update(identity).digest("hex"),
        message,
        stack,
    };
}
