import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReportQueue,
  dispatchReport,
  dispatchReportBatch,
  flushReportQueue,
  getReportConfig,
  lazyReportBatch,
  report,
  resetReportConfig,
  setConfig,
  subscribeReports,
} from "../src/report.js";

describe("reporting", () => {
  beforeEach(() => {
    resetReportConfig();
    clearReportQueue();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("merges defined configuration values, including false and zero", () => {
    setConfig({
      url: "/monitor",
      projectName: "storefront",
      appId: "web",
      userId: "user-1",
      isImageUpload: true,
      batchSize: 8,
    });
    setConfig({
      isImageUpload: false,
      batchSize: 0,
      projectName: undefined,
    });

    expect(getReportConfig()).toEqual({
      url: "/monitor",
      projectName: "storefront",
      appId: "web",
      userId: "user-1",
      release: "",
      isImageUpload: false,
      batchSize: 0,
    });
  });

  it("wraps report data and prefers sendBeacon", () => {
    const sendBeacon = vi.fn<(url: string, data: string) => boolean>(
      () => true,
    );
    vi.stubGlobal("window", {
      navigator: { sendBeacon },
      requestIdleCallback: (callback: () => void) => callback(),
    });
    vi.stubGlobal("navigator", window.navigator);
    setConfig({
      url: "/monitor",
      projectName: "storefront",
      appId: "web",
      userId: "user-1",
    });

    expect(report({ type: "error" })).toBe(true);

    const [url, body] = sendBeacon.mock.calls[0] ?? [];
    expect(url).toBe("/monitor");
    expect(JSON.parse(String(body))).toMatchObject({
      id: expect.stringMatching(/^id-/),
      data: { type: "error" },
    });
  });

  it("uses an encoded image request when image upload is enabled", () => {
    const images: Array<{ src: string }> = [];
    vi.stubGlobal("window", { navigator: {} });
    vi.stubGlobal(
      "Image",
      class {
        private value = "";

        set src(src: string) {
          this.value = src;
          images.push(this);
        }

        get src(): string {
          return this.value;
        }
      },
    );
    setConfig({ url: "/monitor", isImageUpload: true });

    expect(report({ type: "performance" })).toBe(true);
    expect(images).toHaveLength(1);

    const requestUrl = new URL(images[0]!.src, "https://example.com");
    expect(JSON.parse(requestUrl.searchParams.get("data") ?? "")).toMatchObject({
      id: expect.stringMatching(/^id-/),
      data: { type: "performance" },
    });
  });

  it("reports and clears a batch as soon as batchSize is reached", () => {
    const sendBeacon = vi.fn<(url: string, data: string) => boolean>(
      () => true,
    );
    vi.stubGlobal("window", {
      navigator: { sendBeacon },
      requestIdleCallback: (callback: () => void) => callback(),
    });
    vi.stubGlobal("navigator", window.navigator);
    setConfig({ url: "/monitor", batchSize: 2 });

    lazyReportBatch({ sequence: 1 });
    expect(sendBeacon).not.toHaveBeenCalled();

    lazyReportBatch({ sequence: 2 });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(sendBeacon.mock.calls[0]?.[1])).data,
    ).toEqual([{ sequence: 1 }, { sequence: 2 }]);

    lazyReportBatch({ sequence: 3 });
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("sends a replay batch together even when ordinary batchSize is one", () => {
    const sendBeacon = vi.fn<(url: string, data: string) => boolean>(() => true);
    vi.stubGlobal("window", {
      navigator: { sendBeacon },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", window.navigator);
    setConfig({ url: "/monitor", batchSize: 1 });

    dispatchReportBatch([{ type: "replay", replayOffset: 1 }, { type: "replay", replayOffset: 2 }]);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const request = sendBeacon.mock.calls[0];
    expect(JSON.parse(String(request?.[1])).data).toEqual([
      { type: "replay", replayOffset: 1 },
      { type: "replay", replayOffset: 2 },
    ]);
  });

  it("dispatches collected data to local subscribers and callbacks", () => {
    const subscriber = vi.fn();
    const callback = vi.fn();
    const unsubscribe = subscribeReports(subscriber);

    dispatchReport({ type: "behavior", subType: "click" }, callback);
    unsubscribe();

    expect(subscriber).toHaveBeenCalledWith({
      type: "behavior",
      subType: "click",
    });
    expect(callback).toHaveBeenCalledWith({
      type: "behavior",
      subType: "click",
    });
  });

  it("keeps a batch when sendBeacon rejects it", () => {
    const sendBeacon = vi
      .fn<(url: string, data: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    vi.stubGlobal("window", {
      navigator: { sendBeacon },
      requestIdleCallback: (callback: () => void) => callback(),
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", window.navigator);
    setConfig({ url: "/monitor", batchSize: 2 });

    expect(lazyReportBatch({ sequence: 1 })).toBe(false);
    expect(lazyReportBatch({ sequence: 2 })).toBe(false);
    expect(flushReportQueue()).toBe(true);
    expect(JSON.parse(String(sendBeacon.mock.calls[1]?.[1])).data).toEqual([
      { sequence: 1 },
      { sequence: 2 },
    ]);
  });

  it("flushes an incomplete batch explicitly", () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("window", {
      navigator: { sendBeacon },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("navigator", window.navigator);
    setConfig({ url: "/monitor", batchSize: 5 });

    lazyReportBatch({ sequence: 1 });
    expect(flushReportQueue()).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(flushReportQueue()).toBe(false);
  });
});
