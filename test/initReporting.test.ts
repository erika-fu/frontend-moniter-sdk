import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  init,
  observeClick,
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
        protocolVersion: 1,
        id: expect.stringMatching(/^id-/),
        projectName: "sdk-demo",
        appId: "vue-demo",
        sessionId: expect.any(String),
        timestamp: expect.any(Number),
        release: "",
        userId: "demo-user",
        user: { id: "demo-user" },
        environment: {
          url: "https://demo.example.com/",
          userAgent: expect.any(String),
          language: expect.any(String),
        },
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

  it("reports errors after a click path contains circular DOM references", () => {
    const images: Array<{ src: string }> = [];
    const eventHandlers = new Map<string, (event: Event) => void>();
    const target = {
      tagName: "BUTTON",
      innerHTML: "Vue error",
      outerHTML: "<button>Vue error</button>",
      offsetWidth: 100,
      offsetHeight: 36,
    };
    const windowTarget: { self?: unknown } = {};
    windowTarget.self = windowTarget;
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
      addEventListener: vi.fn(
        (type: string, handler: (event: Event) => void) => {
          eventHandlers.set(type, handler);
        },
      ),
      removeEventListener: vi.fn(),
      performance: { now: () => 42 },
    });
    vi.stubGlobal("performance", { now: () => 42 });
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

    frontendMonitor.init({
      url: "/reportData",
      isImageUpload: true,
      batchSize: 1,
    });
    observeClick();
    eventHandlers.get("mousedown")?.({
      target,
      timeStamp: 24,
      composedPath: () => [target, windowTarget],
    } as unknown as MouseEvent);
    frontendMonitor.install(app);
    app.config.errorHandler?.(
      new Error("demo: Vue component error"),
      null,
      "native event handler",
    );

    expect(images).toHaveLength(2);
    const reports = images.map((image) => {
      const requestUrl = new URL(image.src, "https://demo.example.com");
      return JSON.parse(requestUrl.searchParams.get("data") ?? "").data[0];
    });
    expect(reports).toEqual([
      expect.objectContaining({
        type: "behavior",
        subType: "click",
      }),
      expect.objectContaining({
        type: "error",
        subType: "vue",
      }),
    ]);
  });
});
