/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { observePV, stopObserveBehavior } from "../src/behavior/index.js";
import {
  observeViewLargestContentfulPaint,
  resetViewLargestContentfulPaint,
  stopObserveViewLargestContentfulPaint,
  type ViewLargestContentfulPaintReportData,
} from "../src/performance/observeViewLCP.js";

function captureEventListeners(target: EventTarget): {
  emit: (type: string, event: Partial<Event>) => void;
  restore: () => void;
} {
  const originalAdd = target.addEventListener.bind(target);
  const originalRemove = target.removeEventListener.bind(target);
  const listeners = new Map<string, Set<EventListener>>();
  target.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (typeof listener === "function") {
      const set = listeners.get(String(type)) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(String(type), set);
    }
    originalAdd(type, listener, options);
  }) as EventTarget["addEventListener"];
  target.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (typeof listener === "function") {
      listeners.get(String(type))?.delete(listener);
    }
    originalRemove(type, listener, options);
  }) as EventTarget["removeEventListener"];
  return {
    emit(type, event) {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event as Event);
      }
    },
    restore() {
      target.addEventListener = originalAdd;
      target.removeEventListener = originalRemove;
    },
  };
}

describe("view-largest-contentful-paint", () => {
  let documentEvents: ReturnType<typeof captureEventListeners>;

  afterEach(() => {
    resetViewLargestContentfulPaint();
    stopObserveBehavior();
    documentEvents?.restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  function preparePageView(options: {
    path?: string;
    pageName?: string;
    routePattern?: string;
    startSource?: "manual" | "navigation";
    viewId?: string;
    startTime?: number;
  } = {}): ReturnType<typeof vi.spyOn> {
    const path = options.path ?? "/products/1";
    window.history.replaceState({}, "", path);
    Object.defineProperty(document, "referrer", {
      configurable: true,
      get: () => "",
    });
    const now = vi.spyOn(performance, "now").mockReturnValue(options.startTime ?? 100);
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      (options.viewId ?? "view-1") as `${string}-${string}-${string}-${string}-${string}`,
    );
    observePV(undefined, {
      ...(options.pageName !== undefined ? { pageName: options.pageName } : {}),
      ...(options.routePattern !== undefined
        ? { routePattern: options.routePattern }
        : {}),
      startSource: options.startSource ?? "navigation",
    });
    return now;
  }

  function box(element: HTMLElement, width: number, height: number): HTMLElement {
    const rect = {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON() {
        return {};
      },
    } as DOMRect;
    element.getBoundingClientRect = () => rect;
    return element;
  }

  function textBlock(text: string, width: number, height: number): HTMLElement {
    const element = document.createElement("p");
    element.textContent = text;
    return box(element, width, height);
  }

  function armTrustedEvents(): void {
    documentEvents = captureEventListeners(document);
  }

  it("reports one final largest candidate for the Page View only after trusted interaction", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
      startTime: 1_000,
    });

    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });

    now.mockReturnValue(1_100);
    root.append(textBlock("Summary", 80, 40));
    await Promise.resolve();
    expect(onReport).not.toHaveBeenCalled();

    now.mockReturnValue(1_400);
    root.append(textBlock("Primary product story", 320, 180));
    await Promise.resolve();

    now.mockReturnValue(1_600);
    root.append(textBlock("footnote", 20, 10));
    await Promise.resolve();
    expect(onReport).not.toHaveBeenCalled();

    now.mockReturnValue(1_900);
    documentEvents.emit("pointerdown", { isTrusted: true });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith({
      type: "performance",
      subType: "view-largest-contentful-paint",
      name: "VLCP",
      value: 400,
      pageUrl: window.location.href,
      viewId: "view-1",
      measurementSource: "declared-region",
      startSource: "navigation",
      finalizationReason: "interaction",
      pageName: "product-detail",
      routePattern: "/products/:id",
    });

    documentEvents.emit("pointerdown", { isTrusted: true });
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("keeps candidates inside the declared region and ignores excluded or retained content", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    const retained = textBlock("old shell", 900, 900);
    root.append(retained);
    document.body.append(root);

    const outside = textBlock("outside hero", 800, 800);
    document.body.append(outside);

    const now = preparePageView({ startTime: 500, viewId: "view-region" });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });

    now.mockReturnValue(550);
    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-view-skeleton", "");
    skeleton.append(textBlock("Loading", 800, 800));
    root.append(skeleton);
    await Promise.resolve();

    const excluded = [
      ["nav", "data-view-navigation", "Public navigation"],
      ["div", "data-view-overlay", "Modal overlay"],
      ["aside", "data-view-advertising", "Sponsored banner"],
      ["section", "data-view-recommendation", "You may also like"],
    ] as const;
    now.mockReturnValue(600);
    for (const [tag, attribute, text] of excluded) {
      const region = document.createElement(tag);
      region.setAttribute(attribute, "");
      region.append(textBlock(text, 700, 700));
      root.append(region);
    }
    await Promise.resolve();

    now.mockReturnValue(800);
    const included = document.createElement("p");
    included.textContent = "Primary story";
    box(included, 200, 100);
    root.append(included);
    await Promise.resolve();

    now.mockReturnValue(1_100);
    const optedIn = document.createElement("aside");
    optedIn.setAttribute("data-view-advertising", "");
    optedIn.setAttribute("data-view-lcp-include", "");
    optedIn.append(textBlock("Included sponsorship", 500, 400));
    root.append(optedIn);
    await Promise.resolve();

    documentEvents.emit("pointerdown", { isTrusted: true });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "view-largest-contentful-paint",
        viewId: "view-region",
        value: 600,
        finalizationReason: "interaction",
        measurementSource: "declared-region",
      }),
    );
  });

  it("does not finalize on an untrusted interaction", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ startTime: 10 });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    now.mockReturnValue(40);
    root.append(textBlock("Story", 100, 40));
    await Promise.resolve();

    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    documentEvents.emit("pointerdown", { isTrusted: false });
    expect(onReport).not.toHaveBeenCalled();

    documentEvents.emit("keydown", { isTrusted: true });
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 30,
        finalizationReason: "interaction",
      }),
    );
  });

  it("finalizes the current candidate when the page hides", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ startTime: 100, viewId: "view-hide" });
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    now.mockReturnValue(180);
    root.append(textBlock("Hero", 300, 120));
    await Promise.resolve();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: "view-hide",
        value: 80,
        finalizationReason: "page-hidden",
      }),
    );
  });

  it("finalizes the previous Page View when the next one starts", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({
      path: "/products/1",
      pageName: "product-detail",
      startTime: 100,
      viewId: "view-a",
    });
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    now.mockReturnValue(260);
    root.append(textBlock("Hero", 240, 80));
    await Promise.resolve();

    now.mockReturnValue(900);
    preparePageView({
      path: "/cart",
      pageName: "cart",
      startTime: 900,
      viewId: "view-b",
    });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: "view-a",
        pageName: "product-detail",
        value: 160,
        finalizationReason: "next-page-view",
      }),
    );
  });

  it("uses the candidate paint time when observation times out", async () => {
    vi.useFakeTimers();
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ startTime: 1_000, viewId: "view-timeout" });
    observeViewLargestContentfulPaint({ root, onReport, timeout: 5_000 });
    now.mockReturnValue(1_250);
    root.append(textBlock("Hero", 200, 80));
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: "view-timeout",
        value: 250,
        finalizationReason: "timeout",
      }),
    );
  });

  it("does not invent a measurement when timeout or the next Page View has no candidate", async () => {
    vi.useFakeTimers();
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ path: "/empty", startTime: 10, viewId: "view-empty" });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    now.mockReturnValue(80);
    root.append(textBlock("late hero", 400, 200));
    await Promise.resolve();
    documentEvents.emit("pointerdown", { isTrusted: true });
    expect(onReport).not.toHaveBeenCalled();

    preparePageView({ path: "/still-empty", startTime: 20, viewId: "view-empty-2" });
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    preparePageView({ path: "/next", startTime: 30, viewId: "view-empty-3" });
    expect(onReport).not.toHaveBeenCalled();
  });

  it("cleanup stops observation without turning the candidate into a report", async () => {
    vi.useFakeTimers();
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ startTime: 100, viewId: "view-cleanup" });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 1_000 });
    now.mockReturnValue(220);
    root.append(textBlock("Hero", 180, 80));
    await Promise.resolve();

    stopObserveViewLargestContentfulPaint();
    await vi.advanceTimersByTimeAsync(1_000);
    documentEvents.emit("pointerdown", { isTrusted: true });
    documentEvents.emit("keydown", { isTrusted: true });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    preparePageView({ path: "/after-cleanup", startTime: 400, viewId: "view-after" });

    expect(onReport).not.toHaveBeenCalled();
  });

  it("times a reused element from the new Page View", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const hero = textBlock("Hero", 200, 80);
    const now = preparePageView({ path: "/first", startTime: 100, viewId: "view-first" });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    now.mockReturnValue(180);
    root.append(hero);
    await Promise.resolve();
    documentEvents.emit("pointerdown", { isTrusted: true });
    expect(onReport).toHaveBeenCalledTimes(1);

    hero.remove();
    onReport.mockClear();
    const second = preparePageView({
      path: "/second",
      startTime: 1_000,
      viewId: "view-second",
    });
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });
    second.mockReturnValue(1_050);
    root.append(hero);
    await Promise.resolve();
    documentEvents.emit("pointerdown", { isTrusted: true });

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: "view-second",
        value: 50,
        finalizationReason: "interaction",
      }),
    );
  });

  it("keeps the largest candidate after it is removed and after an image loads", async () => {
    const onReport = vi.fn<(data: ViewLargestContentfulPaintReportData) => void>();
    const root = document.createElement("main");
    document.body.append(root);
    const now = preparePageView({ startTime: 100, viewId: "view-stable" });
    armTrustedEvents();
    observeViewLargestContentfulPaint({ root, onReport, timeout: 60_000 });

    const large = textBlock("Hero", 400, 200);
    now.mockReturnValue(220);
    root.append(large);
    await Promise.resolve();

    now.mockReturnValue(360);
    root.append(textBlock("caption", 40, 20));
    await Promise.resolve();
    large.remove();
    await Promise.resolve();

    const image = document.createElement("img");
    image.alt = "poster";
    root.append(image);
    await Promise.resolve();
    now.mockReturnValue(480);
    box(image, 500, 300);
    image.dispatchEvent(new Event("load"));

    documentEvents.emit("pointerdown", { isTrusted: true });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        viewId: "view-stable",
        value: 380,
        finalizationReason: "interaction",
      }),
    );
  });
});
