// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const reportFrameworkError = vi.hoisted(() => vi.fn());

vi.mock("../../src/index.js", () => ({
    default: {
        errorBoundary: reportFrameworkError,
    },
}));

import { ErrorBoundary } from "./ErrorBoundary.js";

let container: HTMLDivElement;
let root: Root;

function BrokenComponent(): ReactNode {
    throw new Error("render failed");
}

beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    reportFrameworkError.mockClear();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe("React error boundary", () => {
    it("forwards render errors to the SDK and exposes recovery", () => {
        const onReset = vi.fn();
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        act(() => {
            root.render(
                <ErrorBoundary onReset={onReset}>
                    <BrokenComponent />
                </ErrorBoundary>,
            );
        });

        expect(reportFrameworkError).toHaveBeenCalledOnce();
        expect(reportFrameworkError.mock.calls[0]?.[0]).toMatchObject({
            message: "render failed",
        });
        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
            "React 异常已捕获",
        );

        const resetButton = container.querySelector("button");
        act(() => resetButton?.click());
        expect(onReset).toHaveBeenCalledOnce();
    });
});
