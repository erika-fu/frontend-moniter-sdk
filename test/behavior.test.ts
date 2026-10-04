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
      path,
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
      path,
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
});
