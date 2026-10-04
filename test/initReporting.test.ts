import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  init,
  observePV,
  stopObserveBehavior,
} from "../src/index.js";
import frontendMonitor from "../src/index.js";
import {
  clearReportQueue,
  resetReportConfig,
} from "../src/report.js";

describe("reporting after SDK initialization", () => {
  beforeEach(() => {
    resetReportConfig();
    clearReportQueue();
  });

  afterEach(() => {
    stopObserveBehavior();
    vi.unstubAllGlobals();
  });

  it("reports collected data with the initialized project identity", () => {
    const images: Array<{ src: string }> = [];

    vi.stubGlobal("window", {
      location: { href: "https://demo.example.com/" },
      addEventListener: vi.fn(),
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });
    vi.stubGlobal(
      "Image",
      class {
        private value = "";

        set src(src: string) {
          this.value = src;
          images.push(this);
        }

        get src(): string {
          return this.value;
        }
      },
    );

    init({
      url: "/reportData",
      projectName: "sdk-demo",
      appId: "vue-demo",
      userId: "demo-user",
      isImageUpload: true,
      batchSize: 1,
    });
    observePV();

    expect(images).toHaveLength(1);
    const requestUrl = new URL(images[0]!.src, "https://demo.example.com");
    expect(JSON.parse(requestUrl.searchParams.get("data") ?? "")).toMatchObject(
      {
        id: expect.stringMatching(/^id-/),
        projectName: "sdk-demo",
        appId: "vue-demo",
        userId: "demo-user",
        data: [
          {
            type: "behavior",
            subType: "pv",
            pageUrl: "https://demo.example.com/",
            uuid: "pv-id",
          },
        ],
      },
    );
  });

  it("observes behavior and Vue errors without passing report options", () => {
    const onReport = vi.fn();
    const app = {
      config: {
        errorHandler: null as
          | ((
              error: unknown,
              instance: unknown,
              info: string,
            ) => unknown)
          | null,
      },
    };

    vi.stubGlobal("window", {
      location: { href: "https://demo.example.com/" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      performance: { now: () => 42 },
    });
    vi.stubGlobal("document", { referrer: "" });
    vi.stubGlobal("performance", { now: () => 42 });
    vi.stubGlobal("crypto", { randomUUID: () => "pv-id" });

    const unsubscribe = frontendMonitor.subscribe(onReport);
    frontendMonitor.init();
    frontendMonitor.behavior();
    frontendMonitor.install(app);
    app.config.errorHandler?.(
      new Error("demo: Vue component error"),
      null,
      "component event handler",
    );
    unsubscribe();

    expect(onReport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "behavior",
        subType: "pv",
      }),
    );
    expect(onReport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: "error",
        subType: "vue",
        info: "component event handler",
      }),
    );
  });
});
