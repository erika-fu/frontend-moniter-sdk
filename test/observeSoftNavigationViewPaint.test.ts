/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { observePV, stopObserveBehavior } from "../src/behavior/index.js";
import {
  markViewFirstContentfulPaint,
  observeViewFirstContentfulPaint,
  resetViewFirstContentfulPaint,
  type ViewFirstContentfulPaintReportData,
} from "../src/performance/observeViewFCP.js";
import {
  resetViewLargestContentfulPaint,
  type ViewLargestContentfulPaintReportData,
} from "../src/performance/observeViewLCP.js";
import {
  getSoftNavigationSupport,
  isSoftNavigationSupported,
  observeSoftNavigationViewPaint,
  resetSoftNavigationViewPaint,
  stopObserveSoftNavigationViewPaint,
  type SoftNavigationSupportStatus,
} from "../src/performance/observeSoftNavigationViewPaint.js";

type ObserverCallback = ConstructorParameters<typeof PerformanceObserver>[0];

class PerformanceObserverMock {
  static instances: PerformanceObserverMock[] = [];
  static supportedTypes = new Set<string>([
    "soft-navigation",
    "interaction-contentful-paint",
  ]);
  static rejectTypes = new Set<string>();

  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  observe = vi.fn((options: PerformanceObserverInit) => {
    const type = options.type;
    if (typeof type === "string" && PerformanceObserverMock.rejectTypes.has(type)) {
      throw new Error(`unsupported entry type: ${type}`);
    }
  });
  callback: ObserverCallback;

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    PerformanceObserverMock.instances.push(this);
  }

  static reset(): void {
    PerformanceObserverMock.instances = [];
    PerformanceObserverMock.supportedTypes = new Set([
      "soft-navigation",
      "interaction-contentful-paint",
    ]);
    PerformanceObserverMock.rejectTypes = new Set();
  }

  static deliver(
    index: number,
    entries: PerformanceEntry[],
  ): void {
    const observer = PerformanceObserverMock.instances[index];
    if (!observer) {
      throw new Error(`missing observer at ${index}`);
    }
    const list = {
      getEntries: () => entries,
      getEntriesByName: () => entries,
      getEntriesByType: () => entries,
    };
    observer.callback(list, observer as unknown as PerformanceObserver);
  }
}

function softNavEntry(options: {
  name: string;
  startTime: number;
  navigationId?: number;
  interactionId?: number;
  paintTime?: number;
  presentationTime?: number;
  largestIcp?: {
    startTime: number;
    interactionId: number;
    largestContentfulPaint?: { startTime: number; size: number };
  } | null;
}): PerformanceEntry {
  const navigationId = options.navigationId ?? 2;
  const interactionId = options.interactionId ?? 42;
  return {
    name: options.name,
    entryType: "soft-navigation",
    startTime: options.startTime,
    duration: 0,
    navigationId,
    interactionId,
    paintTime: options.paintTime,
    presentationTime: options.presentationTime,
    getLargestInteractionContentfulPaint: () => options.largestIcp ?? null,
    toJSON: () => ({}),
  } as PerformanceEntry;
}

describe("soft-navigation view paint", () => {
  afterEach(() => {
    resetSoftNavigationViewPaint();
    resetViewFirstContentfulPaint();
    resetViewLargestContentfulPaint();
    stopObserveBehavior();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    PerformanceObserverMock.reset();
  });

  function softNavObserverIndex(): number {
    const softObserver = PerformanceObserverMock.instances.find((instance) =>
      instance.observe.mock.calls.some(
        (call) =>
          (call[0] as PerformanceObserverInit | undefined)?.type ===
          "soft-navigation",
      ),
    );
    if (!softObserver) {
      throw new Error("soft-navigation observer missing");
    }
    return PerformanceObserverMock.instances.indexOf(softObserver);
  }

  function preparePageView(options: {
    path?: string;
    pageName?: string;
    routePattern?: string;
    startSource?: "manual" | "navigation";
    viewId?: string;
    startTime?: number;
  } = {}): { pageUrl: string; now: ReturnType<typeof vi.spyOn> } {
    const path = options.path ?? "/products/1";
    window.history.replaceState({}, "", path);
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "",
    });
    const now = vi
      .spyOn(performance, "now")
      .mockReturnValue(options.startTime ?? 100);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      (options.viewId ??
        "view-1") as `${string}-${string}-${string}-${string}-${string}`,
    );
    observePV(undefined, {
      ...(options.pageName !== undefined ? { pageName: options.pageName } : {}),
      ...(options.routePattern !== undefined
        ? { routePattern: options.routePattern }
        : {}),
      startSource: options.startSource ?? "navigation",
    });
    return { pageUrl: window.location.href, now };
  }

  function stubSupportedObserver(): void {
    vi.stubGlobal("PerformanceObserver", PerformanceObserverMock);
    (
      PerformanceObserverMock as unknown as {
        supportedEntryTypes?: readonly string[];
      }
    ).supportedEntryTypes = [
      "soft-navigation",
      "interaction-contentful-paint",
    ];
  }

  it("reports VFCP from a correlated soft-navigation entry with soft-navigation source", () => {
    stubSupportedObserver();
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    const { pageUrl } = preparePageView({
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
      startTime: 100,
      viewId: "view-1",
    });

    observeSoftNavigationViewPaint({ onViewFCP: onReport });

    const softObserver = PerformanceObserverMock.instances.find((instance) =>
      instance.observe.mock.calls.some(
        (call) =>
          (call[0] as PerformanceObserverInit | undefined)?.type ===
          "soft-navigation",
      ),
    );
    expect(softObserver).toBeDefined();

    PerformanceObserverMock.deliver(
      PerformanceObserverMock.instances.indexOf(softObserver!),
      [
        softNavEntry({
          name: pageUrl,
          startTime: 120,
          presentationTime: 340,
          paintTime: 330,
        }),
      ],
    );

    expect(onReport).toHaveBeenCalledWith({
      type: "performance",
      subType: "view-first-contentful-paint",
      name: "VFCP",
      value: 240,
      pageUrl,
      viewId: "view-1",
      measurementSource: "soft-navigation",
      startSource: "navigation",
      pageName: "product-detail",
      routePattern: "/products/:id",
    });
    expect(isSoftNavigationSupported()).toBe(true);
    expect(getSoftNavigationSupport()).toEqual({
      status: "supported",
    } satisfies SoftNavigationSupportStatus);
  });

  it("lets soft-navigation win over a later application-mark for the same Page View", () => {
    stubSupportedObserver();
    const softReport = vi.fn();
    const markReport = vi.fn();
    const { pageUrl, now } = preparePageView({
      startTime: 100,
      viewId: "view-1",
      startSource: "navigation",
    });

    observeSoftNavigationViewPaint({ onViewFCP: softReport });
    const softObserver = PerformanceObserverMock.instances.find((instance) =>
      instance.observe.mock.calls.some(
        (call) =>
          (call[0] as PerformanceObserverInit | undefined)?.type ===
          "soft-navigation",
      ),
    )!;

    PerformanceObserverMock.deliver(
      PerformanceObserverMock.instances.indexOf(softObserver),
      [
        softNavEntry({
          name: pageUrl,
          startTime: 110,
          presentationTime: 250,
        }),
      ],
    );
    expect(softReport).toHaveBeenCalledTimes(1);

    now.mockReturnValue(400);
    markViewFirstContentfulPaint(markReport);
    expect(markReport).not.toHaveBeenCalled();
  });

  it("keeps Measurement Source independent from Start Source", () => {
    stubSupportedObserver();
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    const { pageUrl } = preparePageView({
      startSource: "navigation",
      startTime: 50,
      viewId: "view-router",
    });

    observeSoftNavigationViewPaint({ onViewFCP: onReport });
    const softObserver = PerformanceObserverMock.instances.find((instance) =>
      instance.observe.mock.calls.some(
        (call) =>
          (call[0] as PerformanceObserverInit | undefined)?.type ===
          "soft-navigation",
      ),
    )!;

    PerformanceObserverMock.deliver(
      PerformanceObserverMock.instances.indexOf(softObserver),
      [
        softNavEntry({
          name: pageUrl,
          startTime: 80,
          presentationTime: 180,
        }),
      ],
    );

    expect(onReport.mock.calls[0]?.[0]).toMatchObject({
      measurementSource: "soft-navigation",
      startSource: "navigation",
      value: 130,
      viewId: "view-router",
    });
  });

  it("degrades safely when soft-navigation observe registration is rejected", () => {
    stubSupportedObserver();
    PerformanceObserverMock.rejectTypes.add("soft-navigation");
    const onReport = vi.fn();

    expect(() =>
      observeSoftNavigationViewPaint({ onViewFCP: onReport }),
    ).not.toThrow();
    expect(isSoftNavigationSupported()).toBe(false);
    expect(getSoftNavigationSupport().status).toBe("unsupported");

    preparePageView({ startTime: 10, viewId: "view-fallback" });
    markViewFirstContentfulPaint(onReport);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        measurementSource: "application-mark",
        viewId: "view-fallback",
      }),
    );
  });

  it("does nothing harmful when PerformanceObserver is unavailable", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const onReport = vi.fn();
    expect(() =>
      observeSoftNavigationViewPaint({ onViewFCP: onReport }),
    ).not.toThrow();
    expect(isSoftNavigationSupported()).toBe(false);
    expect(onReport).not.toHaveBeenCalled();
  });

  it("disconnects observers on stop and reset", () => {
    stubSupportedObserver();
    observeSoftNavigationViewPaint();
    const created = [...PerformanceObserverMock.instances];
    expect(created.length).toBeGreaterThan(0);

    stopObserveSoftNavigationViewPaint();
    for (const observer of created) {
      expect(observer.disconnect).toHaveBeenCalled();
    }

    PerformanceObserverMock.reset();
    observeSoftNavigationViewPaint();
    const second = [...PerformanceObserverMock.instances];
    resetSoftNavigationViewPaint();
    for (const observer of second) {
      expect(observer.disconnect).toHaveBeenCalled();
    }
  });

  it("defers application-mark until soft-navigation claims the Page View", () => {
    stubSupportedObserver();
    const softReport = vi.fn();
    const markReport = vi.fn();
    const { pageUrl, now } = preparePageView({
      startTime: 100,
      viewId: "view-defer",
      startSource: "navigation",
    });

    observeSoftNavigationViewPaint({ onViewFCP: softReport });
    now.mockReturnValue(180);
    markViewFirstContentfulPaint(markReport);
    expect(markReport).not.toHaveBeenCalled();

    PerformanceObserverMock.deliver(softNavObserverIndex(), [
      softNavEntry({
        name: pageUrl,
        startTime: 110,
        presentationTime: 260,
      }),
    ]);
    expect(softReport).toHaveBeenCalledTimes(1);
    expect(markReport).not.toHaveBeenCalled();
  });

  it("releases deferred application-mark after soft-nav wait timeout", () => {
    vi.useFakeTimers();
    stubSupportedObserver();
    const softReport = vi.fn();
    const markReport = vi.fn();
    const { now } = preparePageView({
      startTime: 100,
      viewId: "view-wait",
      startSource: "navigation",
    });

    observeSoftNavigationViewPaint({
      onViewFCP: softReport,
      softNavWait: 50,
    });
    now.mockReturnValue(160);
    markViewFirstContentfulPaint(markReport);
    expect(markReport).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(softReport).not.toHaveBeenCalled();
    expect(markReport).toHaveBeenCalledWith(
      expect.objectContaining({
        measurementSource: "application-mark",
        viewId: "view-wait",
        value: 60,
      }),
    );
    vi.useRealTimers();
  });

  it("releases deferred application-mark on the next Page View", () => {
    stubSupportedObserver();
    const softReport = vi.fn();
    const markReport = vi.fn();
    const { now } = preparePageView({
      path: "/products/1",
      startTime: 100,
      viewId: "view-old",
      startSource: "navigation",
    });

    observeSoftNavigationViewPaint({
      onViewFCP: softReport,
      softNavWait: 60_000,
    });
    now.mockReturnValue(150);
    markViewFirstContentfulPaint(markReport);
    expect(markReport).not.toHaveBeenCalled();

    now.mockReturnValue(200);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "view-new" as `${string}-${string}-${string}-${string}-${string}`,
    );
    window.history.replaceState({}, "", "/products/2");
    observePV(undefined, {
      startSource: "navigation",
      viewId: "view-new",
    });

    expect(softReport).not.toHaveBeenCalled();
    expect(markReport).toHaveBeenCalledWith(
      expect.objectContaining({
        measurementSource: "application-mark",
        viewId: "view-old",
      }),
    );
  });

  it("prefers soft-navigation over declared-content for the same Page View", async () => {
    stubSupportedObserver();
    const softReport = vi.fn();
    const declaredReport = vi.fn();
    const { pageUrl, now } = preparePageView({
      startTime: 100,
      viewId: "view-declared",
      startSource: "manual",
    });

    observeSoftNavigationViewPaint({ onViewFCP: softReport });
    const root = document.createElement("div");
    document.body.append(root);
    observeViewFirstContentfulPaint({ root, onReport: declaredReport });

    now.mockReturnValue(150);
    const content = document.createElement("p");
    content.setAttribute("data-view-content", "");
    content.textContent = "Ready";
    root.append(content);
    await Promise.resolve();
    expect(declaredReport).not.toHaveBeenCalled();

    PerformanceObserverMock.deliver(softNavObserverIndex(), [
      softNavEntry({
        name: pageUrl,
        startTime: 120,
        presentationTime: 300,
      }),
    ]);
    expect(softReport).toHaveBeenCalledTimes(1);
    expect(declaredReport).not.toHaveBeenCalled();
    root.remove();
  });

  it("reports VLCP from soft-navigation ICP with independent Start Source", () => {
    stubSupportedObserver();
    const onViewLCP =
      vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const { pageUrl } = preparePageView({
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
      startTime: 100,
      viewId: "view-lcp-soft",
    });

    observeSoftNavigationViewPaint({ onViewLCP, lcpTimeout: 5_000 });
    PerformanceObserverMock.deliver(softNavObserverIndex(), [
      softNavEntry({
        name: pageUrl,
        startTime: 120,
        presentationTime: 200,
        interactionId: 7,
        largestIcp: {
          startTime: 280,
          interactionId: 7,
          largestContentfulPaint: { startTime: 280, size: 12_000 },
        },
      }),
    ]);

    const hidden = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    if (hidden) {
      Object.defineProperty(document, "visibilityState", hidden);
    } else {
      // jsdom default
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    }

    expect(onViewLCP).toHaveBeenCalledWith({
      type: "performance",
      subType: "view-largest-contentful-paint",
      name: "VLCP",
      value: 180,
      pageUrl,
      viewId: "view-lcp-soft",
      measurementSource: "soft-navigation",
      startSource: "navigation",
      finalizationReason: "page-hidden",
      pageName: "product-detail",
      routePattern: "/products/:id",
    });
  });

  it("ignores soft-navigation entries that do not correlate with the active Page View", () => {
    stubSupportedObserver();
    const onReport = vi.fn();
    preparePageView({
      path: "/products/1",
      startTime: 100,
      viewId: "view-corr",
    });
    observeSoftNavigationViewPaint({ onViewFCP: onReport });

    PerformanceObserverMock.deliver(softNavObserverIndex(), [
      softNavEntry({
        name: "https://example.test/other",
        startTime: 120,
        presentationTime: 300,
      }),
    ]);
    expect(onReport).not.toHaveBeenCalled();
  });

  it("treats missing interaction-contentful-paint support as partial and falls back", () => {
    stubSupportedObserver();
    (
      PerformanceObserverMock as unknown as {
        supportedEntryTypes: readonly string[];
      }
    ).supportedEntryTypes = ["soft-navigation"];
    const markReport = vi.fn();
    expect(() => observeSoftNavigationViewPaint()).not.toThrow();
    expect(getSoftNavigationSupport()).toEqual({
      status: "unsupported",
      reason: "partial",
    });

    preparePageView({ startTime: 20, viewId: "view-partial" });
    markViewFirstContentfulPaint(markReport);
    expect(markReport).toHaveBeenCalledWith(
      expect.objectContaining({
        measurementSource: "application-mark",
        viewId: "view-partial",
      }),
    );
  });
});
