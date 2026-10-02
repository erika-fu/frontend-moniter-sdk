import { afterEach, describe, expect, it, vi } from "vitest";
import { observeResources } from "../src/performance/observeResources.js";

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

const resourceEntry = {
  name: "https://example.com/app.js",
  entryType: "resource",
  startTime: 10,
  duration: 50,
  initiatorType: "script",
  domainLookupStart: 11,
  domainLookupEnd: 13,
  connectStart: 13,
  connectEnd: 18,
  redirectStart: 0,
  redirectEnd: 0,
  requestStart: 20,
  responseStart: 30,
  nextHopProtocol: "h2",
  encodedBodySize: 800,
  transferSize: 1000,
  decodedBodySize: 1200,
  toJSON: () => ({}),
} as PerformanceResourceTiming;

describe("observeResources", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    PerformanceObserverMock.callback = undefined;
    PerformanceObserverMock.instances = [];
  });

  it("observes buffered resources after the page has loaded", () => {
    const onReport = vi.fn();
    vi.stubGlobal("PerformanceObserver", PerformanceObserverMock);
    vi.stubGlobal("document", { readyState: "complete" });
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    observeResources(onReport);

    const observer = PerformanceObserverMock.instances[0];
    expect(observer?.observe).toHaveBeenCalledWith({
      type: "resource",
      buffered: true,
    });

    const list = {
      getEntries: () => [resourceEntry],
      getEntriesByName: () => [resourceEntry],
      getEntriesByType: () => [resourceEntry],
    };
    PerformanceObserverMock.callback?.(
      list,
      observer as unknown as PerformanceObserver,
    );

    expect(observer?.disconnect).toHaveBeenCalledOnce();
    expect(onReport).toHaveBeenCalledWith({
      name: "https://example.com/app.js",
      type: "performance",
      subType: "resource",
      sourceType: "script",
      duration: 50,
      dns: 2,
      tcp: 5,
      redirect: 0,
      ttfb: 10,
      protocol: "h2",
      responseBodySize: 800,
      responseHeaderSize: 200,
      transferSize: 1000,
      resourceSize: 1200,
      startTime: 10,
      pageUrl: "https://example.com/",
    });
  });

  it("waits for load and removes its event listener", () => {
    let loadHandler: (() => void) | undefined;
    const addEventListener = vi.fn(
      (_type: string, handler: () => void) => {
        loadHandler = handler;
      },
    );
    const removeEventListener = vi.fn();

    vi.stubGlobal("PerformanceObserver", PerformanceObserverMock);
    vi.stubGlobal("document", { readyState: "loading" });
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener,
    });

    observeResources();

    expect(PerformanceObserverMock.instances).toHaveLength(0);
    expect(addEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
      true,
    );

    loadHandler?.();

    expect(PerformanceObserverMock.instances).toHaveLength(1);
    expect(removeEventListener).toHaveBeenCalledWith(
      "load",
      loadHandler,
      true,
    );
  });

  it("does nothing outside a supported browser environment", () => {
    vi.stubGlobal("window", undefined);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("PerformanceObserver", undefined);

    expect(() => observeResources()).not.toThrow();
    expect(PerformanceObserverMock.instances).toHaveLength(0);
  });
});
