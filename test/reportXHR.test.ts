import { afterEach, describe, expect, it, vi } from "vitest";

describe("XHR report transport", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("uses captured XHR methods instead of monitored prototype wrappers", async () => {
    const originalOpen = vi.fn();
    const originalSend = vi.fn();
    const wrappedOpen = vi.fn();
    const wrappedSend = vi.fn();

    class FakeXMLHttpRequest {
      static instances: FakeXMLHttpRequest[] = [];

      declare open: typeof originalOpen;
      declare send: typeof originalSend;
      setRequestHeader = vi.fn();

      constructor() {
        FakeXMLHttpRequest.instances.push(this);
      }
    }

    FakeXMLHttpRequest.prototype.open = originalOpen;
    FakeXMLHttpRequest.prototype.send = originalSend;
    vi.stubGlobal("XMLHttpRequest", FakeXMLHttpRequest);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("window", {
      navigator,
      requestIdleCallback: (callback: () => void) => callback(),
    });

    const { report, setConfig } = await import("../src/report.js");
    FakeXMLHttpRequest.prototype.open = wrappedOpen;
    FakeXMLHttpRequest.prototype.send = wrappedSend;
    setConfig({ url: "/monitor" });

    expect(report({ type: "error" })).toBe(true);
    expect(originalOpen).toHaveBeenCalledWith("POST", "/monitor");
    expect(originalSend).toHaveBeenCalledOnce();
    expect(wrappedOpen).not.toHaveBeenCalled();
    expect(wrappedSend).not.toHaveBeenCalled();
    expect(
      FakeXMLHttpRequest.instances[0]?.setRequestHeader,
    ).toHaveBeenCalledWith("Content-Type", "application/json");
  });
});
