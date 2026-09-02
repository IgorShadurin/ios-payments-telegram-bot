import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { RegisteredApp } from "./types";

const APP_STORE_CONNECT_ORIGIN = "https://api.appstoreconnect.apple.com";
const ITUNES_LOOKUP_ORIGIN = "https://itunes.apple.com";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;
const RATE_LIMIT_RESERVE = 20;
const DEFAULT_LOW_LIMIT_PAUSE_MS = 60 * 60 * 1_000;
const MAX_RETRY_AFTER_MS = 60 * 60 * 1_000;
const RETRY_DELAYS_MS = [5_000, 20_000] as const;

const resourceLinksSchema = z.object({
  next: z.string().url().optional(),
});

const reportRequestsSchema = z.object({
  data: z.array(
    z.object({
      type: z.literal("analyticsReportRequests"),
      id: z.string().min(1).max(255),
      attributes: z.object({
        accessType: z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]),
        stoppedDueToInactivity: z.boolean().optional(),
      }),
    }),
  ),
  links: resourceLinksSchema,
});

const reportRequestSchema = z.object({
  data: z.object({
    type: z.literal("analyticsReportRequests"),
    id: z.string().min(1).max(255),
    attributes: z.object({
      accessType: z.enum(["ONGOING", "ONE_TIME_SNAPSHOT"]),
      stoppedDueToInactivity: z.boolean().optional(),
    }),
  }),
});

const reportsSchema = z.object({
  data: z.array(
    z.object({
      type: z.literal("analyticsReports"),
      id: z.string().min(1).max(255),
      attributes: z.object({
        name: z.string().min(1).max(500),
        category: z.string().min(1).max(100),
      }),
    }),
  ),
  links: resourceLinksSchema,
});

const instancesSchema = z.object({
  data: z.array(
    z.object({
      type: z.literal("analyticsReportInstances"),
      id: z.string().min(1).max(255),
      attributes: z.object({
        granularity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
        processingDate: z.iso.date(),
      }),
    }),
  ),
  links: resourceLinksSchema,
});

const segmentsSchema = z.object({
  data: z.array(
    z.object({
      type: z.literal("analyticsReportSegments"),
      id: z.string().min(1).max(255),
      attributes: z.object({
        checksum: z.string().regex(/^[a-fA-F0-9]{32}$/),
        sizeInBytes: z.number().int().min(0).max(MAX_SEGMENT_BYTES),
        url: z.string().url(),
      }),
    }),
  ),
  links: resourceLinksSchema,
});

const lookupSchema = z.object({
  resultCount: z.number().int().min(0),
  results: z.array(
    z.object({
      trackId: z.number().int().positive(),
      trackName: z.string().min(1).max(500),
      bundleId: z.string().min(1).max(255).optional(),
      artworkUrl512: z.string().url().optional(),
      artworkUrl100: z.string().url().optional(),
    }),
  ),
});

export const ANALYTICS_REPORT_NAMES = {
  impressions: "App Store Discovery and Engagement Standard",
  downloads: "App Downloads Standard",
  proceeds: "App Store Purchases Standard",
} as const;

export const ANALYTICS_COMPLETENESS_DAYS = {
  impressions: 3,
  downloads: 2,
  proceeds: 2,
} as const satisfies Record<AnalyticsMetric, number>;

export type AnalyticsMetric = keyof typeof ANALYTICS_REPORT_NAMES;

export class AppStoreAnalyticsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AppStoreAnalyticsError";
  }
}

export interface AppStoreAnalyticsClientOptions {
  fetchImplementation?: typeof fetch;
  wait?: (milliseconds: number) => Promise<unknown>;
  lowLimitPauseMs?: number;
  now?: () => Date;
}

interface AnalyticsReportSummary {
  id: string;
  name: string;
}

interface ReportInstanceSummary {
  id: string;
  processingDate: string;
}

interface TsvRow {
  [header: string]: string;
}

function addUtcCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function rateLimitRemaining(header: string | null): number | undefined {
  const match = header?.match(/(?:^|;)\s*user-hour-rem:(\d+)\s*(?:;|$)/i);
  if (!match) {
    return undefined;
  }
  const remaining = Number(match[1]);
  return Number.isSafeInteger(remaining) ? remaining : undefined;
}

function validateAppleApiUrl(value: string): URL {
  const url = new URL(value, APP_STORE_CONNECT_ORIGIN);
  if (
    url.origin !== APP_STORE_CONNECT_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    !url.pathname.startsWith("/v1/")
  ) {
    throw new AppStoreAnalyticsError(
      "App Store Connect returned an unsafe pagination URL",
    );
  }
  return url;
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new AppStoreAnalyticsError(
      "App Store Connect response is too large",
      response.status,
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new AppStoreAnalyticsError(
      "App Store Connect response is too large",
      response.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppStoreAnalyticsError(
      "App Store Connect returned invalid JSON",
      response.status,
    );
  }
}

function parseTsv(buffer: Buffer): TsvRow[] {
  const text = gunzipSync(buffer)
    .toString("utf8")
    .replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [];
  }
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
  });
}

function numberField(row: TsvRow, field: string): number {
  const value = Number(row[field]);
  if (!Number.isFinite(value)) {
    throw new AppStoreAnalyticsError(
      `Analytics report contains an invalid ${field} value`,
    );
  }
  return value;
}

export function aggregateMetricRows(
  metric: AnalyticsMetric,
  rows: readonly TsvRow[],
  reportDate: string,
): number {
  const forDate = rows.filter((row) => row.Date === reportDate);
  if (metric === "impressions") {
    return forDate
      .filter(
        (row) =>
          row.Event === "Impression" ||
          (row.Event === "Page view" && row["Page Type"] === "Product page"),
      )
      .reduce((sum, row) => sum + numberField(row, "Counts"), 0);
  }
  if (metric === "downloads") {
    return forDate
      .filter((row) => {
        const downloadType = row["Download Type"]
          ?.replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        return (
          downloadType === "first-time download" ||
          downloadType === "redownload"
        );
      })
      .reduce((sum, row) => sum + numberField(row, "Counts"), 0);
  }
  return forDate.reduce(
    (sum, row) => sum + numberField(row, "Proceeds in USD"),
    0,
  );
}

export class AppStoreAnalyticsClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly wait: (milliseconds: number) => Promise<unknown>;
  private readonly lowLimitPauseMs: number;
  private readonly now: () => Date;
  private pauseBeforeNextRequestMs = 0;

  constructor(
    private readonly token: string,
    options: AppStoreAnalyticsClientOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.wait = options.wait ?? delay;
    this.lowLimitPauseMs =
      options.lowLimitPauseMs ?? DEFAULT_LOW_LIMIT_PAUSE_MS;
    this.now = options.now ?? (() => new Date());
  }

  private async requestJson(
    input: string | URL,
    init: RequestInit = {},
  ): Promise<unknown> {
    const url = validateAppleApiUrl(String(input));
    if (this.pauseBeforeNextRequestMs > 0) {
      const pauseMs = this.pauseBeforeNextRequestMs;
      this.pauseBeforeNextRequestMs = 0;
      await this.wait(pauseMs);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          ...init,
          headers: {
            authorization: `Bearer ${this.token}`,
            accept: "application/json",
            ...init.headers,
          },
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        lastError = new AppStoreAnalyticsError(
          "App Store Connect request failed",
        );
        if (attempt < 2) {
          await this.wait(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw lastError;
      }

      const remaining = rateLimitRemaining(
        response.headers.get("x-rate-limit"),
      );
      if (remaining !== undefined && remaining <= RATE_LIMIT_RESERVE) {
        this.pauseBeforeNextRequestMs = this.lowLimitPauseMs;
      }
      if (response.ok) {
        return readJson(response);
      }

      await response.body?.cancel().catch(() => undefined);
      const retryMs = retryAfterMs(response.headers.get("retry-after"));
      lastError = new AppStoreAnalyticsError(
        `App Store Connect rejected the request with HTTP ${response.status}`,
        response.status,
        retryMs,
      );
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) {
        throw lastError;
      }
      if (retryMs !== undefined && retryMs > MAX_RETRY_AFTER_MS) {
        throw lastError;
      }
      await this.wait(Math.max(RETRY_DELAYS_MS[attempt], retryMs ?? 0));
    }
    throw lastError;
  }

  private async collectPaginated<T>(
    initialUrl: URL,
    schema: z.ZodType<{ data: T[]; links: { next?: string } }>,
  ): Promise<T[]> {
    const all: T[] = [];
    let nextUrl: string | undefined = initialUrl.toString();
    for (let page = 0; nextUrl && page < 20; page += 1) {
      const parsed = schema.parse(await this.requestJson(nextUrl));
      all.push(...parsed.data);
      nextUrl = parsed.links.next;
    }
    if (nextUrl) {
      throw new AppStoreAnalyticsError(
        "App Store Connect pagination exceeded the safety limit",
      );
    }
    return all;
  }

  async findOngoingReportRequest(
    appAppleId: number,
  ): Promise<{ id: string; stopped: boolean } | undefined> {
    const url = new URL(
      `/v1/apps/${encodeURIComponent(String(appAppleId))}/analyticsReportRequests`,
      APP_STORE_CONNECT_ORIGIN,
    );
    url.searchParams.set("filter[accessType]", "ONGOING");
    url.searchParams.set("limit", "200");
    const requests = await this.collectPaginated(url, reportRequestsSchema);
    const ongoing = requests.filter(
      (item) => item.attributes.accessType === "ONGOING",
    );
    const request =
      ongoing.find((item) => !item.attributes.stoppedDueToInactivity) ??
      ongoing[0];
    return request
      ? {
          id: request.id,
          stopped: request.attributes.stoppedDueToInactivity ?? false,
        }
      : undefined;
  }

  async createOngoingReportRequest(appAppleId: number): Promise<string> {
    const parsed = reportRequestSchema.parse(
      await this.requestJson("/v1/analyticsReportRequests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            type: "analyticsReportRequests",
            attributes: { accessType: "ONGOING" },
            relationships: {
              app: {
                data: {
                  type: "apps",
                  id: String(appAppleId),
                },
              },
            },
          },
        }),
      }),
    );
    return parsed.data.id;
  }

  async ensureOngoingReportRequest(
    appAppleId: number,
    getSetupClient: () => AppStoreAnalyticsClient,
  ): Promise<{ id: string; created: boolean }> {
    const current = await this.findOngoingReportRequest(appAppleId);
    if (current && !current.stopped) {
      return { id: current.id, created: false };
    }
    return {
      id: await getSetupClient().createOngoingReportRequest(appAppleId),
      created: true,
    };
  }

  async listRequiredReports(
    reportRequestId: string,
  ): Promise<Partial<Record<AnalyticsMetric, AnalyticsReportSummary>>> {
    const url = new URL(
      `/v1/analyticsReportRequests/${encodeURIComponent(reportRequestId)}/reports`,
      APP_STORE_CONNECT_ORIGIN,
    );
    url.searchParams.set("limit", "200");
    const reports = await this.collectPaginated(url, reportsSchema);
    const result: Partial<Record<AnalyticsMetric, AnalyticsReportSummary>> = {};
    for (const [metric, name] of Object.entries(
      ANALYTICS_REPORT_NAMES,
    ) as Array<[AnalyticsMetric, string]>) {
      const report = reports.find(
        (candidate) => candidate.attributes.name === name,
      );
      if (report) {
        result[metric] = { id: report.id, name: report.attributes.name };
      }
    }
    return result;
  }

  private async listDailyInstances(
    reportId: string,
    processingDate?: string,
  ): Promise<ReportInstanceSummary[]> {
    const url = new URL(
      `/v1/analyticsReports/${encodeURIComponent(reportId)}/instances`,
      APP_STORE_CONNECT_ORIGIN,
    );
    url.searchParams.set("filter[granularity]", "DAILY");
    if (processingDate) {
      url.searchParams.set("filter[processingDate]", processingDate);
    }
    url.searchParams.set("limit", "200");
    const instances = await this.collectPaginated(url, instancesSchema);
    return instances
      .map((item) => ({
        id: item.id,
        processingDate: item.attributes.processingDate,
      }))
      .sort((left, right) =>
        right.processingDate.localeCompare(left.processingDate),
      );
  }

  private async downloadInstanceRows(instanceId: string): Promise<TsvRow[]> {
    const url = new URL(
      `/v1/analyticsReportInstances/${encodeURIComponent(instanceId)}/segments`,
      APP_STORE_CONNECT_ORIGIN,
    );
    url.searchParams.set("limit", "200");
    const segments = await this.collectPaginated(url, segmentsSchema);
    const rows: TsvRow[] = [];
    for (const segment of segments) {
      const downloadUrl = new URL(segment.attributes.url);
      if (downloadUrl.protocol !== "https:") {
        throw new AppStoreAnalyticsError(
          "Apple returned an unsafe analytics segment URL",
        );
      }
      const response = await this.fetchImplementation(downloadUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new AppStoreAnalyticsError(
          `Apple analytics segment download failed with HTTP ${response.status}`,
          response.status,
        );
      }
      const compressed = Buffer.from(await response.arrayBuffer());
      if (
        compressed.length > MAX_SEGMENT_BYTES ||
        compressed.length !== segment.attributes.sizeInBytes
      ) {
        throw new AppStoreAnalyticsError(
          "Apple analytics segment size verification failed",
        );
      }
      const checksum = createHash("md5").update(compressed).digest("hex");
      if (
        checksum.toLowerCase() !== segment.attributes.checksum.toLowerCase()
      ) {
        throw new AppStoreAnalyticsError(
          "Apple analytics segment checksum verification failed",
        );
      }
      rows.push(...parseTsv(compressed));
    }
    return rows;
  }

  async readMetric(
    reportId: string,
    metric: AnalyticsMetric,
    reportDate: string,
  ): Promise<number | undefined> {
    const firstProcessingDate = addUtcCalendarDays(reportDate, 1);
    const completeProcessingDate = addUtcCalendarDays(
      reportDate,
      ANALYTICS_COMPLETENESS_DAYS[metric],
    );
    const currentDate = this.now().toISOString().slice(0, 10);
    let processingDate =
      currentDate < completeProcessingDate
        ? currentDate
        : completeProcessingDate;

    while (processingDate >= firstProcessingDate) {
      const [instance] = await this.listDailyInstances(
        reportId,
        processingDate,
      );
      if (instance) {
        const rows = await this.downloadInstanceRows(instance.id);
        return aggregateMetricRows(metric, rows, reportDate);
      }
      processingDate = addUtcCalendarDays(processingDate, -1);
    }

    return completeProcessingDate < currentDate ? 0 : undefined;
  }
}

export async function fetchPublicAppMetadata(
  app: RegisteredApp,
  fetchImplementation: typeof fetch = fetch,
): Promise<{ name: string; iconUrl?: string }> {
  const url = new URL("/lookup", ITUNES_LOOKUP_ORIGIN);
  url.searchParams.set("id", String(app.appAppleId));
  url.searchParams.set("entity", "software");
  url.searchParams.set("country", "us");
  try {
    const response = await fetchImplementation(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { name: app.name };
    }
    const parsed = lookupSchema.safeParse(await readJson(response));
    const match = parsed.success
      ? parsed.data.results.find((item) => item.trackId === app.appAppleId)
      : undefined;
    return match
      ? {
          name: match.trackName,
          iconUrl: match.artworkUrl512 ?? match.artworkUrl100,
        }
      : { name: app.name };
  } catch {
    return { name: app.name };
  }
}
