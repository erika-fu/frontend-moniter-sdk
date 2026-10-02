import { afterEach, describe, expect, it, vi } from "vitest";
import type { LCPMetric } from "web-vitals";

const { onLCPMock } = vi.hoisted(() => ({
  onLCPMock: vi.fn(),
}));

vi.mock("web-vitals", () => ({
  onLCP: onLCPMock,
}));

import { observeLCP } from "../src/performance/observeLCP.js";

const lcpMetric: LCPMetric = {
  name: "LCP",
  value: 1250,
  rating: "good",
  delta: 1250,
  id: "v4-1",
  entries: [],
  navigationType: "navigate",
  navigationId: 1,
};

describe("observeLCP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("registers an LCP callback", () => {
    const onReport = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com/products?id=1",
      },
    });
    vi.stubGlobal("document", {});
    vi.stubGlobal("PerformanceObserver", vi.fn());

    observeLCP(onReport);

    expect(onLCPMock).toHaveBeenCalledOnce();
    const callback = onLCPMock.mock.calls[0]?.[0] as
      | ((metric: LCPMetric) => void)
      | undefined;
    callback?.(lcpMetric);

    expect(onReport).toHaveBeenCalledWith({
      ...lcpMetric,
      type: "performance",
      subType: "largest-contentful-paint",
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

      observeLCP();

      expect(onLCPMock).not.toHaveBeenCalled();
    },
  );
});
