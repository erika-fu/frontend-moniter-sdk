import { afterEach, describe, expect, it, vi } from "vitest";
import { observeLoad } from "../src/performance/observeLoad.js";

const navigationEntry = {
  entryType: "navigation",
  startTime: 0,
  loadEventEnd: 125,
} as PerformanceNavigationTiming;

describe("observeLoad", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports on the next frame when the page is already loaded", () => {
    const onReport = vi.fn();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(130);
      return 1;
    });

    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("performance", {
      getEntriesByType: vi.fn(() => [navigationEntry]),
    });
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      requestAnimationFrame,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    observeLoad(onReport);

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(onReport).toHaveBeenCalledWith({
      type: "performance",
      subType: "load",
      startTime: 125,
      pageUrl: "https://example.com/",
    });
  });

  it("waits for load and removes its event listener", () => {
    let loadHandler: ((event: Event) => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, handler: (event: Event) => void) => {
        loadHandler = handler;
      },
    );
    const removeEventListener = vi.fn();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(130);
      return 1;
    });

    vi.stubGlobal("document", { readyState: "loading" });
    vi.stubGlobal("performance", {
      getEntriesByType: vi.fn(() => [navigationEntry]),
    });
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      requestAnimationFrame,
      addEventListener,
      removeEventListener,
    });

    observeLoad();

    expect(addEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
      true,
    );

    loadHandler?.({ timeStamp: 120 } as Event);

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith(
      "load",
      loadHandler,
      true,
    );
  });

  it("does nothing outside a supported browser environment", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("performance", undefined);

    expect(() => observeLoad()).not.toThrow();
  });
});
