import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeBehavior,
  observeClick,
  observePageChange,
  observePV,
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
    });
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

  it("reports mouse and touch interactions with element details", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const onReport = vi.fn<(data: BehaviorReportData) => void>();
    const target = {
      tagName: "BUTTON",
      innerHTML: "<span>Buy</span>",
      outerHTML: "<button><span>Buy</span></button>",
      offsetWidth: 120,
      offsetHeight: 36,
    };
    const path = [target, { tagName: "BODY" }];

    vi.stubGlobal("window", {
      addEventListener,
      removeEventListener,
    });

    observeClick(onReport);

    const mouseHandler = addEventListener.mock.calls.find(
      ([type]) => type === "mousedown",
    )?.[1] as ((event: MouseEvent) => void) | undefined;
    mouseHandler?.({
      target,
      timeStamp: 24,
      composedPath: () => path,
    } as unknown as MouseEvent);

    expect(onReport).toHaveBeenCalledWith({
      type: "behavior",
      subType: "click",
      target: "BUTTON",
      startTime: 24,
      innerHtml: "<span>Buy</span>",
      outerHtml: "<button><span>Buy</span></button>",
      width: 120,
      height: 36,
      eventType: "mousedown",
      path: ["BUTTON", "BODY"],
    });

    const touchHandler = addEventListener.mock.calls.find(
      ([type]) => type === "touchstart",
    )?.[1] as ((event: TouchEvent) => void) | undefined;
    touchHandler?.({
      target,
      timeStamp: 25,
      composedPath: () => path,
    } as unknown as TouchEvent);

    expect(onReport).toHaveBeenNthCalledWith(2, {
      type: "behavior",
      subType: "click",
      target: "BUTTON",
      startTime: 25,
      innerHtml: "<span>Buy</span>",
      outerHtml: "<button><span>Buy</span></button>",
      width: 120,
      height: 36,
      eventType: "touchstart",
      path: ["BUTTON", "BODY"],
    });

    stopObserveClick();
    expect(removeEventListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "touchstart",
      expect.any(Function),
      true,
    );
  });

  it("starts every behavior monitor", () => {
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

    expect(addEventListener).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
      true,
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "touchstart",
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
