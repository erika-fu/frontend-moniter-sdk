import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "vue";
import {
  errorBoundary,
  install,
  type ErrorReportData,
  type VueErrorHandlerHost,
} from "../src/error/index.js";
import { setFrameworkErrorReportHandler } from "../src/error/framework.js";
import {
  getReportConfig,
  resetReportConfig,
  setConfig,
} from "../src/report.js";

describe("framework error monitoring", () => {
  afterEach(() => {
    setFrameworkErrorReportHandler();
    resetReportConfig();
    vi.unstubAllGlobals();
  });

  it("installs a Vue error handler and preserves the existing handler", () => {
    const existingHandler = vi.fn();
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    const app = {
      config: {
        errorHandler: existingHandler,
      },
    };
    const error = new Error("render failed");

    vi.stubGlobal("window", {
      location: { href: "https://example.com/vue" },
      performance: { now: () => 21 },
    });

    install(app, { onReport });
    app.config.errorHandler(error, { uid: 1 }, "render function");

    expect(onReport).toHaveBeenCalledWith({
      type: "error",
      subType: "vue",
      error: error.stack,
      info: "render function",
      pageUrl: "https://example.com/vue",
      startTime: 21,
    });
    expect(existingHandler).toHaveBeenCalledWith(
      error,
      { uid: 1 },
      "render function",
    );
  });

  it("does not wrap the same Vue app twice and updates its callback", () => {
    const firstReport = vi.fn();
    const latestReport = vi.fn();
    const app = {
      config: {
        errorHandler: vi.fn(),
      },
    };

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      performance: { now: () => 1 },
    });

    install(app, { onReport: firstReport });
    const installedHandler = app.config.errorHandler;
    install(app, { onReport: latestReport });

    expect(app.config.errorHandler).toBe(installedHandler);

    app.config.errorHandler(new Error("latest"), null, "setup");

    expect(firstReport).not.toHaveBeenCalled();
    expect(latestReport).toHaveBeenCalledOnce();
  });

  it("installs each Vue app independently", () => {
    const firstReport = vi.fn();
    const secondReport = vi.fn();
    const firstApp: VueErrorHandlerHost = {
      config: { errorHandler: null },
    };
    const secondApp: VueErrorHandlerHost = {
      config: { errorHandler: null },
    };

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      performance: { now: () => 1 },
    });

    install(firstApp, { onReport: firstReport });
    install(secondApp, { onReport: secondReport });

    firstApp.config.errorHandler?.(new Error("first"), null, "setup");
    secondApp.config.errorHandler?.(new Error("second"), null, "setup");

    expect(firstReport).toHaveBeenCalledOnce();
    expect(secondReport).toHaveBeenCalledOnce();
  });

  it("allows retrying when handler installation fails", () => {
    const onReport = vi.fn();
    let shouldFail = true;
    let installedHandler:
      | ((error: unknown, instance: unknown, info: string) => unknown)
      | undefined;
    const config: {
      errorHandler?: (
        error: unknown,
        instance: unknown,
        info: string,
      ) => unknown;
    } = {};

    Object.defineProperty(config, "errorHandler", {
      configurable: true,
      get: () => installedHandler,
      set: (handler) => {
        if (shouldFail) {
          throw new Error("install failed");
        }
        installedHandler = handler;
      },
    });

    const app = { config };

    expect(() => install(app)).toThrow("install failed");

    shouldFail = false;
    install(app, { onReport });
    app.config.errorHandler?.(new Error("retried"), null, "setup");

    expect(onReport).toHaveBeenCalledOnce();
  });

  it("accepts a Vue 3 application instance", () => {
    const app = createApp({});

    expect(() => install(app)).not.toThrow();
    expect(app.config.errorHandler).toBeTypeOf("function");
  });

  it("reports React error boundary failures through the configured handler", () => {
    const onReport = vi.fn<(data: ErrorReportData) => void>();
    const error = new Error("component failed");
    const info = { componentStack: "\n    at Widget" };

    vi.stubGlobal("window", {
      location: { href: "https://example.com/react" },
      performance: { now: () => 34 },
    });
    setFrameworkErrorReportHandler(onReport);

    errorBoundary(error, info);

    expect(onReport).toHaveBeenCalledWith({
      type: "error",
      subType: "react",
      error: error.stack,
      info,
      pageUrl: "https://example.com/react",
      startTime: 34,
    });
  });

  it("uses the initialized report configuration when Vue is installed", () => {
    const sdkReport = vi.fn<(data: ErrorReportData) => void>();
    const app = {
      config: {
        errorHandler: null as
          | ((
              error: unknown,
              instance: unknown,
              info: string,
            ) => unknown)
          | null,
      },
    };

    vi.stubGlobal("window", {
      location: { href: "https://example.com/vue" },
      performance: { now: () => 55 },
    });
    setFrameworkErrorReportHandler(sdkReport);
    const initializedConfig = {
      url: "/vue-monitor",
      projectName: "sdk-demo",
      batchSize: 2,
    };
    setConfig(initializedConfig);

    install(app);
    app.config.errorHandler?.(new Error("render failed"), null, "render");

    expect(sdkReport).toHaveBeenCalledOnce();
    expect(getReportConfig()).toMatchObject({
      ...initializedConfig,
    });
  });

  it("allows a React boundary to provide its own report handler", () => {
    const configuredReport = vi.fn();
    const boundaryReport = vi.fn();
    setFrameworkErrorReportHandler(configuredReport);

    errorBoundary(new Error("boom"), {}, boundaryReport);

    expect(boundaryReport).toHaveBeenCalledOnce();
    expect(configuredReport).not.toHaveBeenCalled();
  });
});
