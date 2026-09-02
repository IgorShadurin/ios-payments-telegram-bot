import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_REPORT_NAMES,
  AppStoreAnalyticsClient,
  aggregateMetricRows,
  aggregateMetricRowsRange,
} from "./app-store-analytics";

describe("App Store analytics", () => {
  it("uses Apple's API report name for downloads", () => {
    expect(ANALYTICS_REPORT_NAMES.downloads).toBe("App Downloads Standard");
  });

  it("aggregates App Store Connect impressions, downloads excluding updates, and proceeds", () => {
    const impressions = [
      {
        Date: "2026-08-25",
        Event: "Impression",
        "Page Type": "No page",
        Counts: "133",
      },
      {
        Date: "2026-08-25",
        Event: "Page view",
        "Page Type": "Product page",
        Counts: "9",
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

    expect(aggregateMetricRows("impressions", impressions, "2026-08-25")).toBe(
      142,
    );
    expect(aggregateMetricRows("downloads", downloads, "2026-08-25")).toBe(10);
    expect(aggregateMetricRows("proceeds", proceeds, "2026-08-25")).toBe(10.5);
    expect(
      aggregateMetricRowsRange(
        "impressions",
        impressions,
        "2026-08-24",
        "2026-08-25",
      ),
    ).toBe(241);
  });

  it("uses the newest Apple partition separately for every date in a range", async () => {
    const firstPartition = gzipSync(
      [
        "Date\tDownload Type\tCounts",
        "2026-08-24\tFirst-time download\t3",
        "2026-08-25\tRedownload\t2",
        "",
      ].join("\n"),
    );
    const correctedPartition = gzipSync(
      ["Date\tDownload Type\tCounts", "2026-08-25\tRedownload\t4", ""].join(
        "\n",
      ),
    );
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "reports.example.com") {
        return new Response(
          new Uint8Array(
            url.pathname.includes("corrected")
              ? correctedPartition
              : firstPartition,
          ),
        );
      }
      if (url.pathname.endsWith("/instances")) {
        expect(url.searchParams.get("filter[processingDate]")).toBeNull();
        return Response.json({
          data: [
            {
              type: "analyticsReportInstances",
              id: "first-instance",
              attributes: {
                granularity: "DAILY",
                processingDate: "2026-08-26",
              },
            },
            {
              type: "analyticsReportInstances",
              id: "corrected-instance",
              attributes: {
                granularity: "DAILY",
                processingDate: "2026-08-27",
              },
            },
          ],
          links: {},
        });
      }
      const corrected = url.pathname.includes("corrected-instance");
      const compressed = corrected ? correctedPartition : firstPartition;
      return Response.json({
        data: [
          {
            type: "analyticsReportSegments",
            id: "weekly-segment",
            attributes: {
              checksum: createHash("md5").update(compressed).digest("hex"),
              sizeInBytes: compressed.length,
              url: corrected
                ? "https://reports.example.com/corrected.tsv.gz"
                : "https://reports.example.com/first.tsv.gz",
            },
          },
        ],
        links: {},
      });
    });
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-08-28T14:00:00Z"),
    });

    await expect(
      client.readMetricRange(
        "downloads-report",
        "downloads",
        "2026-08-24",
        "2026-08-25",
      ),
    ).resolves.toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(5);
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

  it("reads the completed processing partition and treats absent rows as zero", async () => {
    const compressed = gzipSync(
      [
        "Date\tEvent\tPage Type\tCounts",
        "2026-08-26\tPage view\tProduct page\t7",
        "",
      ].join("\n"),
    );
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "reports.example.com") {
        return new Response(new Uint8Array(compressed));
      }
      if (url.pathname.endsWith("/instances")) {
        expect(url.searchParams.get("filter[granularity]")).toBe("DAILY");
        expect(url.searchParams.get("filter[processingDate]")).toBe(
          "2026-08-28",
        );
        return Response.json({
          data: [
            {
              type: "analyticsReportInstances",
              id: "instance-complete",
              attributes: {
                granularity: "DAILY",
                processingDate: "2026-08-28",
              },
            },
          ],
          links: {},
        });
      }
      return Response.json({
        data: [
          {
            type: "analyticsReportSegments",
            id: "segment-1",
            attributes: {
              checksum: createHash("md5").update(compressed).digest("hex"),
              sizeInBytes: compressed.length,
              url: "https://reports.example.com/segment.tsv.gz",
            },
          },
        ],
        links: {},
      });
    });
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.readMetric("impressions-report", "impressions", "2026-08-25"),
    ).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a metric pending until its complete processing partition exists", async () => {
    const requestedProcessingDates: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      requestedProcessingDates.push(
        url.searchParams.get("filter[processingDate]") ?? "",
      );
      return Response.json({ data: [], links: {} });
    });
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-08-27T16:00:00Z"),
    });

    await expect(
      client.readMetric("downloads-report", "downloads", "2026-08-25"),
    ).resolves.toBeUndefined();
    expect(requestedProcessingDates).toEqual(["2026-08-27", "2026-08-26"]);
  });

  it("uses the newest available preliminary partition for a recent date", async () => {
    const compressed = gzipSync(
      [
        "Date\tEvent\tPage Type\tCounts",
        "2026-08-31\tImpression\tNo page\t244",
        "2026-08-31\tPage view\tProduct page\t9",
        "",
      ].join("\n"),
    );
    const requestedProcessingDates: string[] = [];
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.hostname === "reports.example.com") {
        return new Response(new Uint8Array(compressed));
      }
      if (url.pathname.endsWith("/instances")) {
        const processingDate =
          url.searchParams.get("filter[processingDate]") ?? "";
        requestedProcessingDates.push(processingDate);
        return Response.json({
          data:
            processingDate === "2026-09-01"
              ? [
                  {
                    type: "analyticsReportInstances",
                    id: "instance-preliminary",
                    attributes: {
                      granularity: "DAILY",
                      processingDate,
                    },
                  },
                ]
              : [],
          links: {},
        });
      }
      return Response.json({
        data: [
          {
            type: "analyticsReportSegments",
            id: "segment-1",
            attributes: {
              checksum: createHash("md5").update(compressed).digest("hex"),
              sizeInBytes: compressed.length,
              url: "https://reports.example.com/segment.tsv.gz",
            },
          },
        ],
        links: {},
      });
    });
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-09-02T14:00:00Z"),
    });

    await expect(
      client.readMetric("impressions-report", "impressions", "2026-08-31"),
    ).resolves.toBe(253);
    expect(requestedProcessingDates).toEqual(["2026-09-02", "2026-09-01"]);
  });

  it("keeps yesterday pending before Apple publishes its first partition", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("filter[processingDate]")).toBe("2026-09-02");
      return Response.json({ data: [], links: {} });
    });
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-09-02T14:00:00Z"),
    });

    await expect(
      client.readMetric("impressions-report", "impressions", "2026-09-01"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an omitted mature partition as zero activity", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [], links: {} }));
    const client = new AppStoreAnalyticsClient("secret", {
      fetchImplementation: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-08-28T00:00:00Z"),
    });

    await expect(
      client.readMetric("downloads-report", "downloads", "2026-08-25"),
    ).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
