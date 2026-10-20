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

describe("view-first-contentful-paint", () => {
  afterEach(() => {
    resetViewFirstContentfulPaint();
    stopObserveBehavior();
    vi.restoreAllMocks();
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

  it("reports one application-mark VFCP linked to the active Page View", () => {
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    const now = preparePageView({
      pageName: "product-detail",
      routePattern: "/products/:id",
      startSource: "navigation",
      startTime: 100,
    });

    now.mockReturnValue(340);
    markViewFirstContentfulPaint(onReport);

    expect(onReport).toHaveBeenCalledWith({
      type: "performance",
      subType: "view-first-contentful-paint",
      name: "VFCP",
      value: 240,
      pageUrl: window.location.href,
      viewId: "view-1",
      measurementSource: "application-mark",
      startSource: "navigation",
      pageName: "product-detail",
      routePattern: "/products/:id",
    });

    markViewFirstContentfulPaint(onReport);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("observes declared content and ignores skeleton, spinner, and retained nodes", async () => {
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    const root = document.createElement("div");
    const retained = document.createElement("p");
    retained.setAttribute("data-view-content", "");
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
    observeViewFirstContentfulPaint({ root, onReport });

    const skeleton = document.createElement("div");
    skeleton.setAttribute("data-view-skeleton", "");
    skeleton.setAttribute("data-view-content", "");
    skeleton.textContent = "loading";

    const spinner = document.createElement("div");
    spinner.setAttribute("data-view-spinner", "");
    spinner.setAttribute("data-view-content", "");
    spinner.textContent = "…";

    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-view-placeholder", "");
    placeholder.setAttribute("data-view-content", "");

    root.append(skeleton, spinner, placeholder);
    await Promise.resolve();
    expect(onReport).not.toHaveBeenCalled();

    const content = document.createElement("article");
    content.setAttribute("data-view-content", "");
    content.textContent = "Cart items ready";
    now.mockReturnValue(180);
    root.append(content);
    await Promise.resolve();

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        subType: "view-first-contentful-paint",
        measurementSource: "declared-content",
        value: 130,
        viewId: "view-1",
        pageName: "cart",
        startSource: "manual",
      }),
    );

    const extra = document.createElement("article");
    extra.setAttribute("data-view-content", "");
    extra.textContent = "more";
    root.append(extra);
    await Promise.resolve();
    expect(onReport).toHaveBeenCalledTimes(1);

    root.remove();
  });

  it("uses a report type distinct from document first-contentful-paint", () => {
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    preparePageView({ startTime: 10 });
    markViewFirstContentfulPaint(onReport);

    expect(onReport.mock.calls[0]?.[0].subType).toBe(
      "view-first-contentful-paint",
    );
    expect(onReport.mock.calls[0]?.[0].subType).not.toBe(
      "first-contentful-paint",
    );
  });

  it("does not allow a second report for the same viewId after stop", async () => {
    const { stopObserveViewFirstContentfulPaint } = await import(
      "../src/performance/observeViewFCP.js"
    );
    const onReport = vi.fn<(data: ViewFirstContentfulPaintReportData) => void>();
    preparePageView({ startTime: 10, viewId: "view-once" });
    markViewFirstContentfulPaint(onReport);
    stopObserveViewFirstContentfulPaint();
    markViewFirstContentfulPaint(onReport);
    expect(onReport).toHaveBeenCalledTimes(1);
  });
});
