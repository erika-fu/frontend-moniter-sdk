import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeError,
  stopObserveError,
  type ErrorReportData,
} from "../src/error/index.js";
import { resetReportConfig, setConfig } from "../src/report.js";

describe("observeError", () => {
  afterEach(() => {
    stopObserveError();
    resetReportConfig();
    vi.unstubAllGlobals();
  });

  it("reports failed resource loads", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    const target = {
      tagName: "SCRIPT",
      src: "https://example.com/app.js",
      href: "",
      outerHTML: '<script src="https://example.com/app.js"></script>',
    };
    const paths = [target, { nodeName: "BODY" }];

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener,
      onerror: null,
    });

    observeError(onReport);

    const resourceHandler = addEventListener.mock.calls.find(
      ([type]) => type === "error",
    )?.[1] as ((event: Event) => void) | undefined;
    resourceHandler?.({
      target,
      timeStamp: 12,
      composedPath: () => paths,
    } as unknown as Event);

    expect(onReport).toHaveBeenCalledWith({
      type: "error",
      subType: "resource",
      url: "https://example.com/app.js",
      html: '<script src="https://example.com/app.js"></script>',
      pageUrl: "https://example.com/",
      paths: ["SCRIPT", "BODY"],
    });
  });

  it("reports JavaScript errors and preserves the previous handler", () => {
    const previousOnError = vi.fn(() => true);
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    const error = new Error("boom");

    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("window", {
      location: { href: "https://example.com/app" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onerror: previousOnError,
    });

    observeError(onReport);

    const result = window.onerror?.("boom", "app.js", 7, 3, error);

    expect(result).toBe(true);
    expect(previousOnError).toHaveBeenCalledWith(
      "boom",
      "app.js",
      7,
      3,
      error,
    );
    expect(onReport).toHaveBeenCalledWith({
      type: "error",
      subType: "js",
      msg: "boom",
      url: "app.js",
      lineNo: 7,
      columnNo: 3,
      stack: error.stack,
      pageUrl: "https://example.com/app",
      startTime: 42,
    });
  });

  it("attaches the configured release to runtime errors", () => {
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onerror: null,
    });
    setConfig({ release: "web@1.2.3" });

    observeError(onReport);
    window.onerror?.("boom", "app.js", 7, 3, new Error("boom"));

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "js",
        release: "web@1.2.3",
      }),
    );
  });

  it("reports unhandled promise rejections", () => {
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    const addEventListener = vi.fn();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener: vi.fn(),
      onerror: null,
    });

    observeError(onReport);

    const rejectionHandler = addEventListener.mock.calls.find(
      ([type]) => type === "unhandledrejection",
    )?.[1] as ((event: PromiseRejectionEvent) => void) | undefined;
    rejectionHandler?.({
      reason: new Error("rejected"),
      timeStamp: 18,
    } as PromiseRejectionEvent);

    expect(onReport).toHaveBeenCalledWith({
      type: "error",
      subType: "promise",
      reason: expect.stringContaining("rejected"),
      stack: expect.stringContaining("Error: rejected"),
      pageUrl: "https://example.com/",
      startTime: 18,
    });
  });

  it("updates the callback without installing duplicate listeners", () => {
    const addEventListener = vi.fn();
    const firstReport = vi.fn();
    const latestReport = vi.fn();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener: vi.fn(),
      onerror: null,
    });

    observeError(firstReport);
    const installedOnError = window.onerror;
    observeError(latestReport);

    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(window.onerror).toBe(installedOnError);

    stopObserveError();

    expect(window.onerror).toBeNull();
  });
});
