import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cancelNavigationAttempt,
  commitNavigationAttempt,
  markNavigationRedirect,
  observeBehavior,
  observeClick,
  observePageChange,
  observePV,
  startNavigationAttempt,
  stopObserveBehavior,
  stopObserveClick,
  stopObservePageChange,
  type BehaviorReportData,
} from "../src/behavior/index.js";

describe("behavior monitoring", () => {
  afterEach(() => {
    stopObserveBehavior();
    vi.unstubAllGlobals();
  });

  it("reports a page view when PV monitoring starts", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/products" },
    });
    vi.stubGlobal("document", {
      referrer: "https://search.example.com/",
    });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", {
      randomUUID: () => "pv-id",
    });

    observePV(onReport);

    expect(onReport).toHaveBeenCalledWith({
      type: "behavior",
      subType: "pv",
      startTime: 42,
      pageUrl: "https://example.com/products",
      referrer: "https://search.example.com/",
      uuid: "pv-id",
      viewId: "pv-id",
      startSource: "manual",
    });
  });

  it("sanitizes sensitive query params and keeps pathname for page views", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/orders?token=secret&id=42#section",
      },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 10 });
    vi.stubGlobal("crypto", { randomUUID: () => "view-1" });

    observePV(onReport);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "pv",
        pageUrl: "https://example.com/orders?id=42#section",
        viewId: "view-1",
        startSource: "manual",
      }),
    );
  });

  it("records page name and route pattern when provided to observePV", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/products/99" },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 15 });
    vi.stubGlobal("crypto", { randomUUID: () => "named-view" });

    observePV(onReport, {
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
    });

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "pv",
        pageName: "product-detail",
        routePattern: "/products/:id",
        startSource: "navigation",
        viewId: "named-view",
      }),
    );
  });

  it("emits a page view only when a navigation attempt is committed", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const now = vi.fn().mockReturnValueOnce(100).mockReturnValue(200);

    vi.stubGlobal("window", {
      location: { href: "https://example.com/login" },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now });
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("cancelled-view")
        .mockReturnValueOnce("attempt-view"),
    });

    startNavigationAttempt({ onReport });
    expect(onReport).not.toHaveBeenCalled();

    cancelNavigationAttempt();
    expect(onReport).not.toHaveBeenCalled();

    startNavigationAttempt({ onReport });
    window.location.href = "https://example.com/home";
    commitNavigationAttempt({
      pageName: "home",
      routePattern: "/home",
    });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "pv",
        startTime: 200,
        pageUrl: "https://example.com/home",
        pageName: "home",
        routePattern: "/home",
        startSource: "navigation",
        viewId: "attempt-view",
      }),
    );
  });

  it("keeps the original start time and redirect count across a redirect chain", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const now = vi
      .fn()
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(80)
      .mockReturnValue(120);

    vi.stubGlobal("window", {
      location: { href: "https://example.com/a" },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now });
    vi.stubGlobal("crypto", { randomUUID: () => "redirect-view" });

    startNavigationAttempt({ onReport });
    startNavigationAttempt({ onReport });
    markNavigationRedirect();
    window.location.href = "https://example.com/b";
    markNavigationRedirect();
    window.location.href = "https://example.com/c";
    commitNavigationAttempt({
      pageName: "final",
      routePattern: "/c",
    });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "pv",
        startTime: 50,
        pageUrl: "https://example.com/c",
        pageName: "final",
        routePattern: "/c",
        redirectCount: 2,
        startSource: "navigation",
        viewId: "redirect-view",
      }),
    );
  });

  it("reports hash and history navigation without duplicate listeners", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const firstReport = vi.fn<(data: BehaviorReportData) => void>();
    const latestReport = vi.fn<(data: BehaviorReportData) => void>();
    const location = { href: "https://example.com/#first" };

    vi.stubGlobal("window", {
      location,
      addEventListener,
      removeEventListener,
    });
    vi.stubGlobal("performance", { now: () => 18 });
    vi.stubGlobal("crypto", {
      randomUUID: vi
        .fn()
        .mockReturnValueOnce("hash-id")
        .mockReturnValueOnce("pop-id"),
    });

    observePageChange(firstReport);
    observePageChange(latestReport);

    expect(addEventListener).toHaveBeenCalledTimes(2);

    const hashHandler = addEventListener.mock.calls.find(
      ([type]) => type === "hashchange",
    )?.[1] as ((event: HashChangeEvent) => void) | undefined;
    hashHandler?.({
      oldURL: "https://example.com/#first",
      newURL: "https://example.com/#second",
    } as HashChangeEvent);

    location.href = "https://example.com/products";
    const popStateHandler = addEventListener.mock.calls.find(
      ([type]) => type === "popstate",
    )?.[1] as ((event: PopStateEvent) => void) | undefined;
    popStateHandler?.({} as PopStateEvent);

    expect(firstReport).not.toHaveBeenCalled();
    expect(latestReport).toHaveBeenNthCalledWith(1, {
      type: "behavior",
      subType: "hashchange",
      from: "https://example.com/#first",
      to: "https://example.com/#second",
      startTime: 18,
      uuid: "hash-id",
    });
    expect(latestReport).toHaveBeenNthCalledWith(2, {
      type: "behavior",
      subType: "popstate",
      from: "https://example.com/#second",
      to: "https://example.com/products",
      startTime: 18,
      uuid: "pop-id",
    });

    stopObservePageChange();
    expect(removeEventListener).toHaveBeenCalledWith(
      "hashchange",
      expect.any(Function),
      true,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function),
      true,
    );
  });

  it("does not install a click listener when clickAttributes are omitted or empty", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener: vi.fn(),
    });

    observeClick({ onReport });
    observeClick({ onReport, clickAttributes: [] });
    observeClick({
      onReport,
      clickAttributes: ["", "  ", "\t", 1, null] as unknown as string[],
    });

    expect(addEventListener).not.toHaveBeenCalled();
    expect(onReport).not.toHaveBeenCalled();
  });

  it("is safe when window is unavailable", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", undefined);

    expect(() =>
      observeClick({ onReport, clickAttributes: ["data-track"] }),
    ).not.toThrow();
    expect(() => stopObserveClick()).not.toThrow();
    expect(onReport).not.toHaveBeenCalled();
  });

  it("reports again after stop and restart", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const target = createMarkedElement("BUTTON", { "data-track": "again" });

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener,
    });

    observeClick({ onReport, clickAttributes: ["data-track"] });
    stopObserveClick();
    observeClick({ onReport, clickAttributes: ["data-track"] });

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "click"),
    ).toHaveLength(2);
    expect(removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );

    const clickHandler = addEventListener.mock.calls
      .filter(([type]) => type === "click")
      .at(-1)?.[1] as ((event: MouseEvent) => void) | undefined;
    clickHandler?.({
      target,
      timeStamp: 40,
      composedPath: () => [target],
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "click",
        attributes: { "data-track": "again" },
      }),
    );
  });

  it("reports attribute-gated clicks with safe metadata only", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const target = createMarkedElement("BUTTON", {
      "data-track": "buy",
      "data-ignored": "secret",
    });
    const path = [target, { tagName: "BODY" }];

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener,
    });

    observeClick({
      onReport,
      clickAttributes: ["data-track"],
    });

    expect(addEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(addEventListener).not.toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );

    const clickHandler = addEventListener.mock.calls.find(
      ([type]) => type === "click",
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    clickHandler?.({
      target,
      timeStamp: 24,
      composedPath: () => path,
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith({
      type: "behavior",
      subType: "click",
      target: "BUTTON",
      startTime: 24,
      width: 120,
      height: 36,
      eventType: "click",
      attributes: { "data-track": "buy" },
      path: ["BUTTON", "BODY"],
    });
    expect(onReport.mock.calls[0]?.[0]).not.toHaveProperty("innerHtml");
    expect(onReport.mock.calls[0]?.[0]).not.toHaveProperty("outerHtml");
    expect(onReport.mock.calls[0]?.[0]).not.toHaveProperty("data-ignored");

    stopObserveClick();
    expect(removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
  });

  it("resolves the nearest marked ancestor and ignores unmarked clicks", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const child = createMarkedElement("SPAN", {});
    const marked = createMarkedElement("DIV", {
      "data-track": "card",
      "data-id": "",
    });
    const outer = createMarkedElement("SECTION", { "data-track": "page" });
    const unmarked = createMarkedElement("P", { "data-other": "x" });

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener: vi.fn(),
    });

    observeClick({
      onReport,
      clickAttributes: ["data-track", "data-id"],
    });

    const clickHandler = addEventListener.mock.calls.find(
      ([type]) => type === "click",
    )?.[1] as ((event: MouseEvent) => void) | undefined;

    clickHandler?.({
      target: child,
      timeStamp: 10,
      composedPath: () => [child, marked, outer, { tagName: "BODY" }],
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "DIV",
        attributes: { "data-track": "card", "data-id": "" },
        path: ["SPAN", "DIV", "SECTION", "BODY"],
      }),
    );

    onReport.mockClear();
    clickHandler?.({
      target: unmarked,
      timeStamp: 11,
      composedPath: () => [unmarked, { tagName: "BODY" }],
    } as unknown as MouseEvent);
    expect(onReport).not.toHaveBeenCalled();
  });

  it("copies and normalizes clickAttributes against caller mutation", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const attributes = [" data-track ", "data-track", "", "data-id"];
    const target = createMarkedElement("BUTTON", {
      "data-track": "a",
      "data-id": "1",
    });

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener: vi.fn(),
    });

    observeClick({ onReport, clickAttributes: attributes });
    attributes.length = 0;

    const clickHandler = addEventListener.mock.calls.find(
      ([type]) => type === "click",
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    clickHandler?.({
      target,
      timeStamp: 1,
      composedPath: () => [target],
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { "data-track": "a", "data-id": "1" },
      }),
    );
  });

  it("updates the click allowlist and callback without duplicate listeners", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const firstReport = vi.fn<(data: BehaviorReportData) => void>();
    const latestReport = vi.fn<(data: BehaviorReportData) => void>();
    const target = createMarkedElement("BUTTON", {
      "data-track": "buy",
      "data-new": "v2",
    });

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener,
    });

    observeClick({
      onReport: firstReport,
      clickAttributes: ["data-track"],
    });
    observeClick({
      onReport: latestReport,
      clickAttributes: ["data-new"],
    });

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "click"),
    ).toHaveLength(1);

    const clickHandler = addEventListener.mock.calls.find(
      ([type]) => type === "click",
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    clickHandler?.({
      target,
      timeStamp: 3,
      composedPath: () => [target],
    } as unknown as MouseEvent);

    expect(firstReport).not.toHaveBeenCalled();
    expect(latestReport).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: { "data-new": "v2" },
      }),
    );

    observeClick({ onReport: latestReport, clickAttributes: [] });
    expect(removeEventListener).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
  });

  it("starts page and navigation monitors without clickAttributes", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 30 });
    vi.stubGlobal("crypto", { randomUUID: () => "selected-pv" });

    observeBehavior({
      onReport,
    });

    expect(addEventListener).not.toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "hashchange",
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "popstate",
      expect.any(Function),
      true,
    );
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "behavior",
        subType: "pv",
        uuid: "selected-pv",
      }),
    );
  });

  it("starts click monitoring from observeBehavior when clickAttributes are set", () => {
    const addEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const target = createMarkedElement("A", { "data-track": "nav" });

    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 30 });
    vi.stubGlobal("crypto", { randomUUID: () => "selected-pv" });

    observeBehavior({
      onReport,
      clickAttributes: ["data-track"],
    });

    const clickHandler = addEventListener.mock.calls.find(
      ([type]) => type === "click",
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    clickHandler?.({
      target,
      timeStamp: 9,
      composedPath: () => [target],
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "click",
        attributes: { "data-track": "nav" },
      }),
    );
  });

  it("skips consecutive page views for the same url", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const location = { href: "https://example.com/products" };

    vi.stubGlobal("window", { location });
    vi.stubGlobal("document", { referrer: "https://search.example.com/" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });

    observePV(onReport);
    observePV(onReport);

    expect(onReport).toHaveBeenCalledTimes(1);

    location.href = "https://example.com/cart";
    observePV(onReport);

    expect(onReport).toHaveBeenCalledTimes(2);
    expect(onReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subType: "pv",
        pageUrl: "https://example.com/cart",
      }),
    );
  });

  it("reports the same url again after behavior monitoring stops", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();

    vi.stubGlobal("window", {
      location: { href: "https://example.com/products" },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });

    observePV(onReport);
    stopObserveBehavior();
    observePV(onReport);

    expect(onReport).toHaveBeenCalledTimes(2);
  });

  it("labels automatic page views with their start source", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const location = { href: "https://example.com/a" };
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const history = {
      pushState: vi.fn((...args: unknown[]) => {
        if (typeof args[2] === "string") {
          location.href = args[2];
        }
      }),
      replaceState: vi.fn(),
    };

    vi.stubGlobal("window", {
      location,
      history,
      addEventListener: vi.fn(
        (type: string, handler: (event: Event) => void) => {
          const current = listeners.get(type) ?? [];
          current.push(handler);
          listeners.set(type, current);
        },
      ),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn().mockImplementation(() => `id-${onReport.mock.calls.length}`),
    });

    observeBehavior({ onReport });
    history.pushState({}, "", "https://example.com/b");

    location.href = "https://example.com/c";
    for (const handler of listeners.get("hashchange") ?? []) {
      handler({} as HashChangeEvent);
    }

    location.href = "https://example.com/d";
    for (const handler of listeners.get("popstate") ?? []) {
      handler({} as PopStateEvent);
    }

    expect(
      onReport.mock.calls
        .map(([report]) => report)
        .filter((report) => report.subType === "pv")
        .map((report) => ({
          pageUrl: report.pageUrl,
          startSource: "startSource" in report ? report.startSource : undefined,
        })),
    ).toEqual([
      { pageUrl: "https://example.com/a", startSource: "initial" },
      { pageUrl: "https://example.com/b", startSource: "history" },
      { pageUrl: "https://example.com/c", startSource: "hashchange" },
      { pageUrl: "https://example.com/d", startSource: "popstate" },
    ]);
  });

  it("reports a page view when history or hash navigation changes the url", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const location = { href: "https://example.com/a" };
    const listeners = new Map<string, Array<(event: Event) => void>>();
    const history = {
      pushState: vi.fn((...args: unknown[]) => {
        if (typeof args[2] === "string") {
          location.href = args[2];
        }
      }),
      replaceState: vi.fn((...args: unknown[]) => {
        if (typeof args[2] === "string") {
          location.href = args[2];
        }
      }),
    };
    const pushState = history.pushState;
    const replaceState = history.replaceState;

    vi.stubGlobal("window", {
      location,
      history,
      addEventListener: vi.fn(
        (type: string, handler: (event: Event) => void) => {
          const current = listeners.get(type) ?? [];
          current.push(handler);
          listeners.set(type, current);
        },
      ),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });

    observeBehavior({ onReport });
    const wrappedPushState = history.pushState;
    observeBehavior({ onReport });

    expect(history.pushState).toBe(wrappedPushState);
    expect(listeners.get("hashchange")).toHaveLength(2);
    expect(onReport).toHaveBeenCalledTimes(1);

    history.pushState({ id: 1 }, "", "https://example.com/b");
    history.pushState({ id: 1 }, "", "https://example.com/b");
    history.replaceState({}, "", "https://example.com/c");

    expect(pushState).toHaveBeenCalledWith({ id: 1 }, "", "https://example.com/b");
    expect(pageViewUrls(onReport)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
    ]);

    location.href = "https://example.com/d";
    for (const handler of listeners.get("hashchange") ?? []) {
      handler({
        oldURL: "https://example.com/c",
        newURL: "https://example.com/d",
      } as HashChangeEvent);
    }
    for (const handler of listeners.get("popstate") ?? []) {
      handler({} as PopStateEvent);
    }

    expect(pageViewUrls(onReport)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
      "https://example.com/c",
      "https://example.com/d",
    ]);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "hashchange",
        to: "https://example.com/d",
      }),
    );

    observePV(onReport);
    expect(pageViewUrls(onReport)).toHaveLength(4);

    stopObservePageChange();
    expect(history.pushState).toBe(pushState);
    expect(history.replaceState).toBe(replaceState);

    history.pushState({}, "", "https://example.com/e");
    expect(pageViewUrls(onReport)).toHaveLength(4);
  });

  it("does not patch history when automatic page views are disabled", () => {
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const location = { href: "https://example.com/a" };
    const addEventListener = vi.fn();
    const history = {
      pushState: vi.fn((...args: unknown[]) => {
        if (typeof args[2] === "string") {
          location.href = args[2];
        }
      }),
      replaceState: vi.fn(),
    };
    const pushState = history.pushState;

    vi.stubGlobal("window", {
      location,
      history,
      addEventListener,
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });

    observeBehavior({ autoPageView: false, onReport });

    expect(history.pushState).toBe(pushState);
    expect(
      addEventListener.mock.calls.filter(([type]) => type === "hashchange"),
    ).toHaveLength(1);

    history.pushState({}, "", "https://example.com/b");
    expect(pageViewUrls(onReport)).toEqual(["https://example.com/a"]);

    observePV(onReport);
    expect(pageViewUrls(onReport)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
});

function pageViewUrls(
  onReport: ReturnType<typeof vi.fn<(data: BehaviorReportData) => void>>,
): string[] {
  const urls: string[] = [];
  for (const [report] of onReport.mock.calls) {
    if (report.subType === "pv") {
      urls.push(report.pageUrl);
    }
  }
  return urls;
}

function createMarkedElement(
  tagName: string,
  attributes: Record<string, string>,
  dimensions: { offsetWidth: number; offsetHeight: number } = {
    offsetWidth: 120,
    offsetHeight: 36,
  },
) {
  return {
    tagName,
    offsetWidth: dimensions.offsetWidth,
    offsetHeight: dimensions.offsetHeight,
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attributes, name);
    },
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null;
    },
  };
}
