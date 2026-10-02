import { afterEach, describe, expect, it, vi } from "vitest";
import type { FCPMetric } from "web-vitals";

const { onFCPMock } = vi.hoisted(() => ({
  onFCPMock: vi.fn(),
}));

vi.mock("web-vitals", () => ({
  onFCP: onFCPMock,
}));

import { observeFCP } from "../src/performance/observeFCP.js";

const fcpMetric: FCPMetric = {
  name: "FCP",
  value: 850,
  rating: "good",
  delta: 850,
  id: "v4-1",
  entries: [],
  navigationType: "navigate",
  navigationId: 1,
};

describe("observeFCP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("registers an FCP callback", () => {
    const onReport = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?id=1",
      },
    });
    vi.stubGlobal("document", {});
    vi.stubGlobal("PerformanceObserver", vi.fn());

    observeFCP(onReport);

    expect(onFCPMock).toHaveBeenCalledOnce();
    const callback = onFCPMock.mock.calls[0]?.[0] as
      | ((metric: FCPMetric) => void)
      | undefined;
    callback?.(fcpMetric);

    expect(onReport).toHaveBeenCalledWith({
      ...fcpMetric,
      type: "performance",
      subType: "first-contentful-paint",
      pageUrl: "https://example.com/products?id=1",
    });
  });

  it.each([
    ["window", undefined, {}, vi.fn()],
    ["document", {}, undefined, vi.fn()],
    ["PerformanceObserver", {}, {}, undefined],
  ])(
    "does nothing when %s is unavailable",
    (_globalName, windowValue, documentValue, observerValue) => {
      vi.stubGlobal("window", windowValue);
      vi.stubGlobal("document", documentValue);
      vi.stubGlobal("PerformanceObserver", observerValue);

      observeFCP();

      expect(onFCPMock).not.toHaveBeenCalled();
    },
  );
});
