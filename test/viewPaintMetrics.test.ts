import { unlinkSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createReportServer } from "../server/index.js";
import { summarizeViewPaintMetrics } from "../server/performance.js";
import { SQLiteReportStore } from "../server/store.js";

const servers: ReturnType<typeof createReportServer>[] = [];
const databases: string[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
  for (const path of databases.splice(0)) {
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  }
});

function envelope(timestamp: number, data: unknown[]): Record<string, unknown> {
  return {
    protocolVersion: 1,
    id: `envelope-${timestamp}`,
    appId: "view-paint-app",
    projectName: "ViewPaint",
    sessionId: "session",
    timestamp,
    release: "1.0.0",
    user: { id: "user" },
    environment: {
      url: "https://example.test/products/1",
      userAgent: "test",
      language: "zh-CN",
    },
    data,
  };
}

async function start(databasePath: string): Promise<string> {
  const server = createReportServer({
    databasePath,
    logger: () => undefined,
  });
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("view paint metric aggregation", () => {
  it("aggregates VFCP by page name with route pattern fallback and source dimensions", () => {
    const rows = [
      {
        id: 1,
        timestamp: 1_000,
        pageUrl: "https://example.test/products/1",
        subType: "view-first-contentful-paint",
        data: {
          value: 100,
          pageName: "product-detail",
          routePattern: "/products/:id",
          measurementSource: "application-mark",
          startSource: "navigation",
        },
      },
      {
        id: 2,
        timestamp: 2_000,
        pageUrl: "https://example.test/products/2",
        subType: "view-first-contentful-paint",
        data: {
          value: 200,
          pageName: "product-detail",
          routePattern: "/products/:id",
          measurementSource: "application-mark",
          startSource: "navigation",
        },
      },
      {
        id: 3,
        timestamp: 3_000,
        pageUrl: "https://example.test/cart",
        subType: "view-first-contentful-paint",
        data: {
          value: 300,
          routePattern: "/cart",
          measurementSource: "declared-content",
          startSource: "history",
        },
      },
      {
        id: 4,
        timestamp: 4_000,
        pageUrl: "https://example.test/",
        subType: "first-contentful-paint",
        data: { value: 50 },
      },
    ];

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-first-contentful-paint"],
      }),
    ).toEqual([
      expect.objectContaining({
        metric: "view-first-contentful-paint",
        sampleCount: 3,
        p50: 200,
        p75: 250,
        p95: 290,
        pages: [
          expect.objectContaining({
            pageKey: "product-detail",
            sampleCount: 2,
            p50: 150,
          }),
          expect.objectContaining({
            pageKey: "/cart",
            sampleCount: 1,
            p50: null,
          }),
        ],
        sources: expect.arrayContaining([
          expect.objectContaining({
            measurementSource: "application-mark",
            startSource: "navigation",
            sampleCount: 2,
          }),
          expect.objectContaining({
            measurementSource: "declared-content",
            startSource: "history",
            sampleCount: 1,
          }),
        ]),
      }),
    ]);
  });

  it("keeps soft-navigation and fallback VFCP sources separate and filterable", () => {
    const rows = [
      {
        id: 1,
        timestamp: 1_000,
        pageUrl: "https://example.test/products/1",
        subType: "view-first-contentful-paint",
        data: {
          value: 120,
          pageName: "product-detail",
          measurementSource: "soft-navigation",
          startSource: "navigation",
        },
      },
      {
        id: 2,
        timestamp: 2_000,
        pageUrl: "https://example.test/products/2",
        subType: "view-first-contentful-paint",
        data: {
          value: 220,
          pageName: "product-detail",
          measurementSource: "declared-content",
          startSource: "navigation",
        },
      },
      {
        id: 3,
        timestamp: 3_000,
        pageUrl: "https://example.test/products/3",
        subType: "view-first-contentful-paint",
        data: {
          value: 320,
          pageName: "product-detail",
          measurementSource: "application-mark",
          startSource: "manual",
        },
      },
    ];

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-first-contentful-paint"],
      }),
    ).toEqual([
      expect.objectContaining({
        metric: "view-first-contentful-paint",
        sampleCount: 3,
        sources: expect.arrayContaining([
          expect.objectContaining({
            measurementSource: "soft-navigation",
            startSource: "navigation",
            sampleCount: 1,
            p50: null,
          }),
          expect.objectContaining({
            measurementSource: "declared-content",
            sampleCount: 1,
          }),
          expect.objectContaining({
            measurementSource: "application-mark",
            sampleCount: 1,
          }),
        ]),
      }),
    ]);

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-first-contentful-paint"],
        measurementSource: "soft-navigation",
      }),
    ).toEqual([
      expect.objectContaining({
        metric: "view-first-contentful-paint",
        sampleCount: 1,
        sources: [
          expect.objectContaining({
            measurementSource: "soft-navigation",
            startSource: "navigation",
            sampleCount: 1,
          }),
        ],
      }),
    ]);
  });

  it("ingests VFCP over HTTP and returns page-oriented query results", async () => {
    const databasePath = `/tmp/view-paint-${Date.now()}-${Math.random()}.sqlite`;
    databases.push(databasePath);
    const baseUrl = await start(databasePath);

    const response = await fetch(`${baseUrl}/api/v1/reportData`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        envelope(1_700_000_000_000, [
          {
            type: "performance",
            subType: "view-first-contentful-paint",
            name: "VFCP",
            value: 240,
            pageUrl: "https://example.test/products/1",
            viewId: "view-1",
            pageName: "product-detail",
            routePattern: "/products/:id",
            measurementSource: "application-mark",
            startSource: "navigation",
          },
          {
            type: "performance",
            subType: "view-first-contentful-paint",
            name: "VFCP",
            value: 360,
            pageUrl: "https://example.test/products/9",
            viewId: "view-2",
            pageName: "product-detail",
            measurementSource: "declared-content",
            startSource: "manual",
          },
          {
            type: "performance",
            subType: "first-contentful-paint",
            value: 80,
            pageUrl: "https://example.test/products/1",
          },
        ]),
      ),
    });
    expect(response.status).toBe(202);

    const viewPaint = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/view-paint?appId=view-paint-app&metrics=view-first-contentful-paint`,
      )
    ).json()) as {
      metrics: Array<{
        metric: string;
        sampleCount: number;
        pages: Array<{ pageKey: string; sampleCount: number }>;
      }>;
    };

    expect(viewPaint.metrics).toEqual([
      expect.objectContaining({
        metric: "view-first-contentful-paint",
        sampleCount: 2,
        pages: [
          expect.objectContaining({
            pageKey: "product-detail",
            sampleCount: 2,
          }),
        ],
      }),
    ]);

    const documentMetrics = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/metrics?appId=view-paint-app&metrics=first-contentful-paint`,
      )
    ).json()) as {
      metrics: Array<{ metric: string; sampleCount: number }>;
    };
    expect(documentMetrics.metrics).toEqual([
      expect.objectContaining({
        metric: "first-contentful-paint",
        sampleCount: 1,
      }),
    ]);

    const store = new SQLiteReportStore(databasePath);
    expect(
      store.performanceMetrics({
        appId: "view-paint-app",
        metrics: ["first-contentful-paint"],
      })[0]?.sampleCount,
    ).toBe(1);
    store.close();
  });

  it("aggregates view LCP with finalization reason and leaves document LCP untouched", () => {
    const rows = [
      {
        id: 1,
        timestamp: 1_000,
        pageUrl: "https://example.test/products/1",
        subType: "view-largest-contentful-paint",
        data: {
          value: 100,
          pageName: "product-detail",
          routePattern: "/products/:id",
          measurementSource: "declared-region",
          startSource: "navigation",
          finalizationReason: "interaction",
        },
      },
      {
        id: 2,
        timestamp: 2_000,
        pageUrl: "https://example.test/products/2",
        subType: "view-largest-contentful-paint",
        data: {
          value: 300,
          pageName: "product-detail",
          measurementSource: "declared-region",
          startSource: "navigation",
          finalizationReason: "interaction",
        },
      },
      {
        id: 3,
        timestamp: 3_000,
        pageUrl: "https://example.test/cart",
        subType: "view-largest-contentful-paint",
        data: {
          value: 500,
          routePattern: "/cart",
          measurementSource: "declared-region",
          startSource: "history",
          finalizationReason: "timeout",
        },
      },
      {
        id: 4,
        timestamp: 4_000,
        pageUrl: "https://example.test/products/1",
        subType: "largest-contentful-paint",
        data: { value: 50 },
      },
      {
        id: 5,
        timestamp: 5_000,
        pageUrl: "https://example.test/products/1",
        subType: "view-first-contentful-paint",
        data: {
          value: 40,
          pageName: "product-detail",
          measurementSource: "application-mark",
          startSource: "navigation",
        },
      },
    ];

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-largest-contentful-paint"],
      }),
    ).toEqual([
      expect.objectContaining({
        metric: "view-largest-contentful-paint",
        sampleCount: 3,
        p50: 300,
        p75: 400,
        p95: 480,
        pages: [
          expect.objectContaining({
            pageKey: "product-detail",
            sampleCount: 2,
            p50: 200,
          }),
          expect.objectContaining({
            pageKey: "/cart",
            sampleCount: 1,
          }),
        ],
        sources: expect.arrayContaining([
          expect.objectContaining({
            measurementSource: "declared-region",
            startSource: "navigation",
            finalizationReason: "interaction",
            sampleCount: 2,
          }),
          expect.objectContaining({
            measurementSource: "declared-region",
            startSource: "history",
            finalizationReason: "timeout",
            sampleCount: 1,
          }),
        ]),
      }),
    ]);

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-first-contentful-paint"],
      })[0]?.sampleCount,
    ).toBe(1);
  });

  it("ingests view LCP over HTTP without merging it into document LCP", async () => {
    const databasePath = `/tmp/view-lcp-${Date.now()}-${Math.random()}.sqlite`;
    databases.push(databasePath);
    const baseUrl = await start(databasePath);

    const response = await fetch(`${baseUrl}/api/v1/reportData`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        envelope(1_700_000_000_000, [
          {
            type: "performance",
            subType: "view-largest-contentful-paint",
            name: "VLCP",
            value: 420,
            pageUrl: "https://example.test/products/1",
            viewId: "view-lcp-1",
            pageName: "product-detail",
            routePattern: "/products/:id",
            measurementSource: "declared-region",
            startSource: "navigation",
            finalizationReason: "page-hidden",
          },
          {
            type: "performance",
            subType: "largest-contentful-paint",
            name: "LCP",
            value: 900,
            pageUrl: "https://example.test/products/1",
          },
        ]),
      ),
    });
    expect(response.status).toBe(202);

    const viewPaint = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/view-paint?appId=view-paint-app&metrics=view-largest-contentful-paint`,
      )
    ).json()) as {
      metrics: Array<{
        metric: string;
        sampleCount: number;
        sources: Array<{ finalizationReason: string; measurementSource: string }>;
      }>;
    };
    expect(viewPaint.metrics).toEqual([
      expect.objectContaining({
        metric: "view-largest-contentful-paint",
        sampleCount: 1,
        sources: [
          expect.objectContaining({
            measurementSource: "declared-region",
            finalizationReason: "page-hidden",
            sampleCount: 1,
          }),
        ],
      }),
    ]);

    const documentMetrics = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/metrics?appId=view-paint-app&metrics=largest-contentful-paint`,
      )
    ).json()) as {
      metrics: Array<{ metric: string; sampleCount: number }>;
    };
    expect(documentMetrics.metrics).toEqual([
      expect.objectContaining({
        metric: "largest-contentful-paint",
        sampleCount: 1,
      }),
    ]);

    const mixed = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/view-paint?appId=view-paint-app&metrics=largest-contentful-paint`,
      )
    ).json()) as { metrics: Array<{ metric: string; sampleCount: number }> };
    expect(mixed.metrics).toEqual([]);
  });

  it("aggregates Key Content Paint by page and name without mixing into VLCP", () => {
    const rows = [
      {
        id: 1,
        timestamp: 1_000,
        pageUrl: "https://example.test/products/1",
        subType: "key-content-paint",
        data: {
          value: 100,
          pageName: "product-detail",
          routePattern: "/products/:id",
          keyContentName: "product-price",
          measurementSource: "application-mark",
          startSource: "navigation",
        },
      },
      {
        id: 2,
        timestamp: 2_000,
        pageUrl: "https://example.test/products/2",
        subType: "key-content-paint",
        data: {
          value: 300,
          pageName: "product-detail",
          keyContentName: "product-price",
          measurementSource: "application-mark",
          startSource: "navigation",
        },
      },
      {
        id: 3,
        timestamp: 3_000,
        pageUrl: "https://example.test/checkout",
        subType: "key-content-paint",
        data: {
          value: 500,
          routePattern: "/checkout",
          keyContentName: "order-status",
          measurementSource: "declared-content",
          startSource: "history",
        },
      },
      {
        id: 4,
        timestamp: 4_000,
        pageUrl: "https://example.test/products/1",
        subType: "view-largest-contentful-paint",
        data: {
          value: 900,
          pageName: "product-detail",
          measurementSource: "declared-region",
          startSource: "navigation",
          finalizationReason: "timeout",
        },
      },
    ];

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["key-content-paint"],
      }),
    ).toEqual([
      expect.objectContaining({
        metric: "key-content-paint",
        sampleCount: 3,
        p50: 300,
        p75: 400,
        p95: 480,
        pages: [
          expect.objectContaining({
            pageKey: "product-detail",
            sampleCount: 2,
            p50: 200,
          }),
          expect.objectContaining({
            pageKey: "/checkout",
            sampleCount: 1,
          }),
        ],
        sources: expect.arrayContaining([
          expect.objectContaining({
            measurementSource: "application-mark",
            startSource: "navigation",
            sampleCount: 2,
          }),
          expect.objectContaining({
            measurementSource: "declared-content",
            startSource: "history",
            sampleCount: 1,
          }),
        ]),
        keyContents: expect.arrayContaining([
          expect.objectContaining({
            keyContentName: "product-price",
            sampleCount: 2,
            p50: 200,
          }),
          expect.objectContaining({
            keyContentName: "order-status",
            sampleCount: 1,
          }),
        ]),
      }),
    ]);

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["key-content-paint"],
        keyContentName: "product-price",
      })[0],
    ).toEqual(
      expect.objectContaining({
        sampleCount: 2,
        keyContents: [
          expect.objectContaining({
            keyContentName: "product-price",
            sampleCount: 2,
          }),
        ],
      }),
    );

    expect(
      summarizeViewPaintMetrics(rows, {
        metrics: ["view-largest-contentful-paint"],
      })[0],
    ).toEqual(
      expect.objectContaining({
        metric: "view-largest-contentful-paint",
        sampleCount: 1,
        p50: null,
      }),
    );
  });

  it("ingests Key Content Paint over HTTP with name filtering", async () => {
    const databasePath = `/tmp/key-content-${Date.now()}-${Math.random()}.sqlite`;
    databases.push(databasePath);
    const baseUrl = await start(databasePath);

    const response = await fetch(`${baseUrl}/api/v1/reportData`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        envelope(1_700_000_000_000, [
          {
            type: "performance",
            subType: "key-content-paint",
            name: "KCP",
            value: 220,
            pageUrl: "https://example.test/products/1",
            viewId: "view-kcp-1",
            keyContentName: "product-price",
            pageName: "product-detail",
            routePattern: "/products/:id",
            measurementSource: "application-mark",
            startSource: "navigation",
          },
          {
            type: "performance",
            subType: "key-content-paint",
            name: "KCP",
            value: 410,
            pageUrl: "https://example.test/products/1",
            viewId: "view-kcp-1",
            keyContentName: "buy-button",
            pageName: "product-detail",
            measurementSource: "declared-content",
            startSource: "navigation",
          },
          {
            type: "performance",
            subType: "view-largest-contentful-paint",
            name: "VLCP",
            value: 800,
            pageUrl: "https://example.test/products/1",
            viewId: "view-kcp-1",
            pageName: "product-detail",
            measurementSource: "declared-region",
            startSource: "navigation",
            finalizationReason: "timeout",
          },
        ]),
      ),
    });
    expect(response.status).toBe(202);

    const filtered = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/view-paint?appId=view-paint-app&metrics=key-content-paint&keyContentName=product-price`,
      )
    ).json()) as {
      metrics: Array<{
        metric: string;
        sampleCount: number;
        keyContents: Array<{ keyContentName: string; sampleCount: number }>;
      }>;
    };
    expect(filtered.metrics).toEqual([
      expect.objectContaining({
        metric: "key-content-paint",
        sampleCount: 1,
        keyContents: [
          expect.objectContaining({
            keyContentName: "product-price",
            sampleCount: 1,
          }),
        ],
      }),
    ]);

    const vlcp = (await (
      await fetch(
        `${baseUrl}/api/v1/performance/view-paint?appId=view-paint-app&metrics=view-largest-contentful-paint`,
      )
    ).json()) as {
      metrics: Array<{ metric: string; sampleCount: number }>;
    };
    expect(vlcp.metrics).toEqual([
      expect.objectContaining({
        metric: "view-largest-contentful-paint",
        sampleCount: 1,
      }),
    ]);
  });
});
