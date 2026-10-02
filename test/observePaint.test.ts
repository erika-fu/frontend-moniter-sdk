import { afterEach, describe, expect, it, vi } from "vitest";
import { observePaint } from "../src/performance/observePaint.js";

type ObserverCallback = ConstructorParameters<typeof PerformanceObserver>[0];

class PerformanceObserverMock {
  static callback: ObserverCallback | undefined;
  static instances: PerformanceObserverMock[] = [];

  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);

  constructor(callback: ObserverCallback) {
    PerformanceObserverMock.callback = callback;
    PerformanceObserverMock.instances.push(this);
  }
}

const firstPaintEntry = {
  name: "first-paint",
  entryType: "paint",
  startTime: 12.5,
  duration: 0,
  toJSON: () => ({}),
} as PerformancePaintTiming;

describe("observePaint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    PerformanceObserverMock.callback = undefined;
    PerformanceObserverMock.instances = [];
  });

  it("observes buffered paint entries and reports first paint", () => {
    const onReport = vi.fn();
    vi.stubGlobal("PerformanceObserver", PerformanceObserverMock);
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?id=1",
      },
    });
    observePaint(onReport);

    const observer = PerformanceObserverMock.instances[0];
    expect(observer?.observe).toHaveBeenCalledWith({
      type: "paint",
      buffered: true,
    });

    const list = {
      getEntries: () => [firstPaintEntry],
      getEntriesByName: () => [firstPaintEntry],
      getEntriesByType: () => [firstPaintEntry],
    };

    PerformanceObserverMock.callback?.(
      list,
      observer as unknown as PerformanceObserver,
    );

    expect(observer?.disconnect).toHaveBeenCalledOnce();
    expect(onReport).toHaveBeenCalledWith({
      name: "first-paint",
      entryType: "paint",
      startTime: 12.5,
      duration: 0,
      type: "performance",
      subType: "first-paint",
      pageUrl: "https://example.com/products?id=1",
    });
  });

  it("ignores other paint entries", () => {
    vi.stubGlobal("PerformanceObserver", PerformanceObserverMock);
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/",
      },
    });
    observePaint();

    const observer = PerformanceObserverMock.instances[0];
    const list = {
      getEntries: () => [],
      getEntriesByName: () => [],
      getEntriesByType: () => [
        { ...firstPaintEntry, name: "first-contentful-paint" },
      ],
    };
    PerformanceObserverMock.callback?.(
      list,
      observer as unknown as PerformanceObserver,
    );

    expect(observer?.disconnect).not.toHaveBeenCalled();
  });

  it("does nothing when PerformanceObserver is unavailable", () => {
    vi.stubGlobal("PerformanceObserver", undefined);

    expect(() => observePaint()).not.toThrow();
  });
});
