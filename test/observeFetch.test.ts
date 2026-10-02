import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeFetch,
  stopObserveFetch,
  type FetchReportData,
} from "../src/performance/observeFetch.js";

describe("observeFetch", () => {
  afterEach(() => {
    stopObserveFetch();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports successful requests and returns the original response", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_080);
    const response = { status: 201, ok: true } as Response;
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const onReport = vi.fn<(data: FetchReportData) => void>();

    vi.stubGlobal("window", {
      fetch: originalFetch,
      location: { href: "https://example.com/checkout" },
    });

    observeFetch(onReport);

    await expect(
      window.fetch("https://api.example.com/orders", {
        method: "post",
      }),
    ).resolves.toBe(response);
    expect(originalFetch).toHaveBeenCalledWith(
      "https://api.example.com/orders",
      { method: "post" },
    );
    expect(onReport).toHaveBeenCalledWith({
      status: 201,
      duration: 80,
      startTime: 2_000,
      endTime: 2_080,
      url: "https://api.example.com/orders",
      method: "POST",
      type: "performance",
      subType: "fetch",
      success: true,
      pageUrl: "https://example.com/checkout",
    });
  });

  it("reports network errors without swallowing the rejection", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_025);
    const networkError = new TypeError("Failed to fetch");
    const originalFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(networkError);
    const onReport = vi.fn<(data: FetchReportData) => void>();

    vi.stubGlobal("window", {
      fetch: originalFetch,
      location: { href: "https://example.com/" },
    });

    observeFetch(onReport);

    await expect(window.fetch("/api/profile")).rejects.toBe(networkError);
    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 0,
        duration: 25,
        url: "/api/profile",
        method: "GET",
        success: false,
      }),
    );
  });

  it("uses Request metadata and lets init override its method", async () => {
    const response = { status: 204, ok: true } as Response;
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const onReport = vi.fn<(data: FetchReportData) => void>();

    vi.stubGlobal("window", {
      fetch: originalFetch,
      location: { href: "https://example.com/" },
    });

    observeFetch(onReport);

    const request = new Request("https://api.example.com/items", {
      method: "PUT",
    });
    await window.fetch(request, { method: "PATCH" });

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://api.example.com/items",
        method: "PATCH",
      }),
    );
  });

  it("installs once and restores the original fetch", async () => {
    const response = { status: 200, ok: true } as Response;
    const originalFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const firstReport = vi.fn();
    const latestReport = vi.fn();

    vi.stubGlobal("window", {
      fetch: originalFetch,
      location: { href: "https://example.com/" },
    });

    observeFetch(firstReport);
    const installedFetch = window.fetch;
    observeFetch(latestReport);

    expect(window.fetch).toBe(installedFetch);
    await window.fetch("/health");
    expect(firstReport).not.toHaveBeenCalled();
    expect(latestReport).toHaveBeenCalledOnce();

    stopObserveFetch();

    expect(window.fetch).toBe(originalFetch);
  });

  it("does nothing when fetch is unavailable", () => {
    vi.stubGlobal("window", { location: { href: "https://example.com/" } });

    expect(() => observeFetch()).not.toThrow();
  });
});
