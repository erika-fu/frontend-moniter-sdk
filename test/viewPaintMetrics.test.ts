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
});
