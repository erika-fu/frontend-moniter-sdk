/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { observePV, stopObserveBehavior } from "../src/behavior/index.js";
import {
  markKeyContentPaint,
  observeKeyContentPaint,
  resetKeyContentPaint,
  type KeyContentPaintReportData,
} from "../src/performance/observeKeyContentPaint.js";

describe("key-content-paint", () => {
  afterEach(() => {
    resetKeyContentPaint();
    stopObserveBehavior();
    vi.restoreAllMocks();
    document.body.replaceChildren();
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

  it("reports one named application-mark KCP linked to the active Page View", () => {
    const onReport = vi.fn<(data: KeyContentPaintReportData) => void>();
    const now = preparePageView({
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
      startTime: 100,
    });

    now.mockReturnValue(350);
    markKeyContentPaint("product-price", onReport);

    expect(onReport).toHaveBeenCalledWith({
      type: "performance",
      subType: "key-content-paint",
      name: "KCP",
      value: 250,
      pageUrl: window.location.href,
      viewId: "view-1",
      keyContentName: "product-price",
      measurementSource: "application-mark",
      startSource: "navigation",
      pageName: "product-detail",
      routePattern: "/products/:id",
    });

    markKeyContentPaint("product-price", onReport);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("allows different key-content names on the same Page View", () => {
    const onReport = vi.fn<(data: KeyContentPaintReportData) => void>();
    const now = preparePageView({ startTime: 100 });

    now.mockReturnValue(200);
    markKeyContentPaint("product-price", onReport);
    now.mockReturnValue(300);
    markKeyContentPaint("order-status", onReport);

    expect(onReport).toHaveBeenCalledTimes(2);
    expect(onReport.mock.calls.map(([report]) => report.keyContentName)).toEqual([
      "product-price",
      "order-status",
    ]);
  });

  it("ignores skeleton, spinner, retained, and empty declared key-content nodes", async () => {
    const onReport = vi.fn<(data: KeyContentPaintReportData) => void>();
    const root = document.createElement("div");
    const retained = document.createElement("p");
    retained.setAttribute("data-key-content", "product-price");
    retained.textContent = "old shell";
    root.append(retained);
    document.body.append(root);

    const now = preparePageView({
      path: "/cart",
      pageName: "cart",
      startSource: "manual",
      startTime: 50,
      viewId: "view-1",
    });
    observeKeyContentPaint({
      name: "product-price",
      root,
      onReport,
    });

    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-view-skeleton", "");
    skeleton.setAttribute("data-key-content", "product-price");
    skeleton.textContent = "loading";

    const spinner = document.createElement("div");
    spinner.setAttribute("data-view-spinner", "");
    spinner.setAttribute("data-key-content", "product-price");
    spinner.textContent = "…";

    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-view-placeholder", "");
    placeholder.setAttribute("data-key-content", "product-price");

    const empty = document.createElement("p");
    empty.setAttribute("data-key-content", "product-price");

    root.append(skeleton, spinner, placeholder, empty);
    await Promise.resolve();
    expect(onReport).not.toHaveBeenCalled();

    const content = document.createElement("p");
    content.setAttribute("data-key-content", "product-price");
    content.textContent = "¥199";
    now.mockReturnValue(180);
    root.append(content);
    await Promise.resolve();

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "key-content-paint",
        keyContentName: "product-price",
        measurementSource: "declared-content",
        value: 130,
        viewId: "view-1",
        pageName: "cart",
        startSource: "manual",
      }),
    );
    expect(onReport).toHaveBeenCalledTimes(1);
    root.remove();
  });

  it("observes a declared key-content target without treating it as VLCP", async () => {
    const onReport = vi.fn<(data: KeyContentPaintReportData) => void>();
    const root = document.createElement("div");
    document.body.append(root);
    const now = preparePageView({
      pageName: "checkout",
      startTime: 50,
    });

    observeKeyContentPaint({
      name: "order-status",
      root,
      onReport,
    });
    expect(onReport).not.toHaveBeenCalled();

    const largeVisual = document.createElement("div");
    largeVisual.style.width = "600px";
    largeVisual.style.height = "400px";
    largeVisual.textContent = "Hero banner";
    root.append(largeVisual);

    const key = document.createElement("p");
    key.setAttribute("data-key-content", "order-status");
    key.textContent = "Paid";
    now.mockReturnValue(180);
    root.append(key);
    await Promise.resolve();

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "key-content-paint",
        name: "KCP",
        keyContentName: "order-status",
        measurementSource: "declared-content",
        value: 130,
        viewId: "view-1",
        pageName: "checkout",
      }),
    );
    expect(onReport.mock.calls[0]?.[0].subType).not.toBe(
      "view-largest-contentful-paint",
    );

    const again = document.createElement("p");
    again.setAttribute("data-key-content", "order-status");
    again.textContent = "Shipped";
    root.append(again);
    await Promise.resolve();
    expect(onReport).toHaveBeenCalledTimes(1);
  });
});
