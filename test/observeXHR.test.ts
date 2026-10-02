import { afterEach, describe, expect, it, vi } from "vitest";
import {
  observeXHR,
  stopObserveXHR,
  type XHRReportData,
} from "../src/performance/observeXHR.js";

type EventHandler = () => void;

class XMLHttpRequestMock {
  status = 0;
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null | undefined;
  listeners = new Map<string, Set<EventHandler>>();

  open(method: string, url: string | URL): void {
    this.method = method;
    this.url = String(url);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null): void {
    this.body = body;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const handler = listener as EventHandler;
    const listeners = this.listeners.get(type) ?? new Set<EventHandler>();
    listeners.add(handler);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.get(type)?.delete(listener as EventHandler);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

describe("observeXHR", () => {
  afterEach(() => {
    stopObserveXHR();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports request timing and response status on loadend", () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_125);
    const onReport = vi.fn<(data: XHRReportData) => void>();

    vi.stubGlobal("XMLHttpRequest", XMLHttpRequestMock);
    vi.stubGlobal("window", {
      location: { href: "https://example.com/products" },
    });

    observeXHR(onReport);

    const request = new XMLHttpRequest();
    request.open("get", "https://api.example.com/products");
    request.send();
    Object.assign(request, { status: 204 });
    (request as unknown as XMLHttpRequestMock).dispatch("loadend");

    expect(now).toHaveBeenCalledTimes(2);
    expect(onReport).toHaveBeenCalledWith({
      status: 204,
      duration: 125,
      startTime: 1_000,
      endTime: 1_125,
      url: "https://api.example.com/products",
      method: "GET",
      type: "performance",
      subType: "xhr",
      success: true,
      pageUrl: "https://example.com/products",
    });
    expect(
      (request as unknown as XMLHttpRequestMock).listeners.get("loadend"),
    ).toHaveLength(0);
  });

  it("marks non-2xx responses as unsuccessful", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const onReport = vi.fn<(data: XHRReportData) => void>();

    vi.stubGlobal("XMLHttpRequest", XMLHttpRequestMock);
    vi.stubGlobal("window", {
      location: { href: "https://example.com/" },
    });

    observeXHR(onReport);

    const request = new XMLHttpRequest();
    request.open("POST", "/orders");
    request.send('{"sku":"one"}');
    Object.assign(request, { status: 500 });
    (request as unknown as XMLHttpRequestMock).dispatch("loadend");

    expect(onReport).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        method: "POST",
        url: "/orders",
        success: false,
      }),
    );
  });

  it("installs once and restores the original methods", () => {
    vi.stubGlobal("XMLHttpRequest", XMLHttpRequestMock);
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const firstReport = vi.fn();
    const latestReport = vi.fn();

    observeXHR(firstReport);
    const installedOpen = XMLHttpRequest.prototype.open;
    const installedSend = XMLHttpRequest.prototype.send;
    observeXHR(latestReport);

    expect(XMLHttpRequest.prototype.open).toBe(installedOpen);
    expect(XMLHttpRequest.prototype.send).toBe(installedSend);

    const request = new XMLHttpRequest();
    request.open("GET", "/health");
    request.send();
    (request as unknown as XMLHttpRequestMock).dispatch("loadend");

    expect(firstReport).not.toHaveBeenCalled();
    expect(latestReport).toHaveBeenCalledOnce();

    stopObserveXHR();

    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it("cleans up when the original send throws", () => {
    vi.stubGlobal("XMLHttpRequest", XMLHttpRequestMock);
    const sendError = new Error("send failed");
    vi.spyOn(XMLHttpRequestMock.prototype, "send").mockImplementation(() => {
      throw sendError;
    });

    observeXHR();

    const request = new XMLHttpRequest();
    request.open("GET", "/health");

    expect(() => request.send()).toThrow(sendError);
    expect(
      (request as unknown as XMLHttpRequestMock).listeners.get("loadend"),
    ).toHaveLength(0);
  });

  it("does nothing when XMLHttpRequest is unavailable", () => {
    vi.stubGlobal("XMLHttpRequest", undefined);

    expect(() => observeXHR()).not.toThrow();
  });
});
