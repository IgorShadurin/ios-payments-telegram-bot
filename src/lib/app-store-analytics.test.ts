import { describe, expect, it, vi } from "vitest";
import {
  AppStoreAnalyticsClient,
  aggregateMetricRows,
} from "./app-store-analytics";

describe("App Store analytics", () => {
  it("aggregates product-page views, downloads excluding updates, and proceeds", () => {
    const views = [
      {
        Date: "2026-08-25",
        Event: "Page view",
        "Page Type": "Product page",
        Counts: "12",
      },
      {
        Date: "2026-08-25",
        Event: "Page view",
        "Page Type": "Store sheet",
        Counts: "4",
      },
      {
        Date: "2026-08-24",
        Event: "Page view",
        "Page Type": "Product page",
        Counts: "99",
      },
    ];
    const downloads = [
      {
        Date: "2026-08-25",
        "Download Type": "First-time download",
        Counts: "7",
      },
      { Date: "2026-08-25", "Download Type": "Redownload", Counts: "3" },
      {
        Date: "2026-08-25",
        "Download Type": "Manual update",
        Counts: "20",
      },
      { Date: "2026-08-25", "Download Type": "Restore", Counts: "8" },
    ];
    const proceeds = [
      { Date: "2026-08-25", "Proceeds in USD": "12.50" },
      { Date: "2026-08-25", "Proceeds in USD": "-2.00" },
    ];

    expect(aggregateMetricRows("views", views, "2026-08-25")).toBe(12);
    expect(aggregateMetricRows("downloads", downloads, "2026-08-25")).toBe(10);
    expect(aggregateMetricRows("proceeds", proceeds, "2026-08-25")).toBe(10.5);
  });

  it("pauses before another request when Apple's hourly allowance reaches reserve", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            data: [
              {
                type: "analyticsReportRequests",
                id: "request-1",
                attributes: {
                  accessType: "ONGOING",
                  stoppedDueToInactivity: false,
                },
              },
            ],
            links: {},
          },
          {
            headers: {
              "x-rate-limit": "user-hour-lim:3500;user-hour-rem:20;",
            },
          },
        ),
      )
      .mockResolvedValueOnce(Response.json({ data: [], links: {} }));
    const wait = vi.fn(async () => undefined);
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      wait,
      lowLimitPauseMs: 123_000,
    });

    await client.findOngoingReportRequest(123456789);
    await client.listRequiredReports("request-1");

    expect(wait).toHaveBeenCalledWith(123_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("creates an ongoing report request with the app resource relationship", async () => {
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo, _init?: RequestInit) =>
        Response.json({
          data: {
            type: "analyticsReportRequests",
            id: "request-new",
            attributes: { accessType: "ONGOING" },
          },
        }),
    );
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    await expect(client.createOngoingReportRequest(987654321)).resolves.toBe(
      "request-new",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      data: {
        attributes: { accessType: "ONGOING" },
        relationships: {
          app: { data: { type: "apps", id: "987654321" } },
        },
      },
    });
  });

  it("creates a missing ongoing request through the Admin setup client", async () => {
    const readFetch = vi.fn(async () => Response.json({ data: [], links: {} }));
    const setupFetch = vi.fn(async () =>
      Response.json({
        data: {
          type: "analyticsReportRequests",
          id: "request-created",
          attributes: { accessType: "ONGOING" },
        },
      }),
    );
    const readClient = new AppStoreAnalyticsClient("sales-key", {
      fetchImplementation: readFetch as unknown as typeof fetch,
    });
    const setupClient = new AppStoreAnalyticsClient("admin-key", {
      fetchImplementation: setupFetch as unknown as typeof fetch,
    });

    await expect(
      readClient.ensureOngoingReportRequest(987654321, () => setupClient),
    ).resolves.toEqual({ id: "request-created", created: true });
    expect(readFetch).toHaveBeenCalledTimes(1);
    expect(setupFetch).toHaveBeenCalledTimes(1);
  });

  it("does not use the Admin setup client when analytics already exists", async () => {
    const readFetch = vi.fn(async () =>
      Response.json({
        data: [
          {
            type: "analyticsReportRequests",
            id: "request-existing",
            attributes: {
              accessType: "ONGOING",
              stoppedDueToInactivity: false,
            },
          },
        ],
        links: {},
      }),
    );
    const setupFetch = vi.fn();
    const readClient = new AppStoreAnalyticsClient("sales-key", {
      fetchImplementation: readFetch as unknown as typeof fetch,
    });
    const setupClient = new AppStoreAnalyticsClient("admin-key", {
      fetchImplementation: setupFetch as unknown as typeof fetch,
    });

    await expect(
      readClient.ensureOngoingReportRequest(987654321, () => setupClient),
    ).resolves.toEqual({ id: "request-existing", created: false });
    expect(setupFetch).not.toHaveBeenCalled();
  });
});
