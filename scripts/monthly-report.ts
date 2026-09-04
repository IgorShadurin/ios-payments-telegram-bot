import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  ANALYTICS_COMPLETENESS_DAYS,
  type AnalyticsMetric,
  AppStoreAnalyticsClient,
  fetchPublicAppMetadata,
} from "../src/lib/app-store-analytics";
import { createAppStoreConnectToken } from "../src/lib/app-store-connect";
import {
  getAppStoreAnalyticsConfig,
  getAppStoreAnalyticsSetupConfig,
  getDatabasePath,
} from "../src/lib/config";
import {
  DAILY_REPORT_TIME_ZONE,
  monthlyReportCaption,
  previousCompletedMonth,
  renderMonthlyReportPng,
} from "../src/lib/daily-report";
import { AppDatabase } from "../src/lib/database";
import {
  sendTelegramPhotoGroup,
  TelegramDeliveryError,
} from "../src/lib/telegram";
import type {
  DailyAppMetrics,
  MonthlyPortfolioReport,
  RegisteredApp,
} from "../src/lib/types";

type CollectedMonthlyAppMetrics = DailyAppMetrics & {
  inferZeroWhenPortfolioPublished: Partial<Record<AnalyticsMetric, boolean>>;
};

class AppleAnalyticsPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppleAnalyticsPendingError";
  }
}

function addUtcCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function monthRange(monthInput?: string): {
  startDate: string;
  endDate: string;
} {
  if (!monthInput) {
    return previousCompletedMonth();
  }
  const month = z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .parse(monthInput);
  const start = new Date(`${month}-01T12:00:00Z`);
  if (
    Number.isNaN(start.getTime()) ||
    start.toISOString().slice(0, 7) !== month
  ) {
    throw new Error("--month must be a valid calendar month in YYYY-MM format");
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return {
    startDate: `${month}-01`,
    endDate: end.toISOString().slice(0, 10),
  };
}

function outputPathForMonth(startDate: string, endDate: string): string {
  const configured = process.env.DAILY_REPORT_OUTPUT_DIR?.trim();
  const directory =
    configured || path.join(path.dirname(getDatabasePath()), "reports");
  return path.join(
    directory,
    `monthly-app-portfolio-${startDate}-to-${endDate}.png`,
  );
}

async function collectApp(
  client: AppStoreAnalyticsClient,
  getSetupClient: () => AppStoreAnalyticsClient,
  app: RegisteredApp,
  startDate: string,
  endDate: string,
): Promise<CollectedMonthlyAppMetrics> {
  const metadata = await fetchPublicAppMetadata(app);
  const ongoingRequest = await client.ensureOngoingReportRequest(
    app.appAppleId,
    getSetupClient,
  );
  let snapshotRequest = await client.findOneTimeSnapshotReportRequest(
    app.appAppleId,
  );
  if (!snapshotRequest) {
    snapshotRequest = {
      id: await getSetupClient().createOneTimeSnapshotReportRequest(
        app.appAppleId,
      ),
    };
    return {
      appAppleId: app.appAppleId,
      name: metadata.name,
      bundleId: app.bundleId,
      iconUrl: metadata.iconUrl,
      firstReleaseDate: metadata.firstReleaseDate,
      impressionsAvailability: "pending",
      downloadsAvailability: "pending",
      proceedsAvailability: "pending",
      inferZeroWhenPortfolioPublished: {},
    };
  }
  const ongoingReports = ongoingRequest.created
    ? {}
    : await client.listRequiredReports(ongoingRequest.id);
  const snapshotReports = await client.listRequiredReports(snapshotRequest.id);
  const values: Partial<Record<AnalyticsMetric, number>> = {};
  const inferZeroWhenPortfolioPublished: Partial<
    Record<AnalyticsMetric, boolean>
  > = {};
  for (const metric of ["impressions", "downloads", "proceeds"] as const) {
    const snapshotReport = snapshotReports[metric];
    if (!snapshotReport) {
      continue;
    }
    const snapshotDate = await client.snapshotProcessingDate(snapshotReport.id);
    if (!snapshotDate) {
      continue;
    }
    const snapshotCoversMonth =
      snapshotDate >=
      addUtcCalendarDays(endDate, ANALYTICS_COMPLETENESS_DAYS[metric]);
    const ongoingReport = ongoingReports[metric];
    const value = snapshotCoversMonth
      ? await client.readSnapshotMetricRange(
          snapshotReport.id,
          metric,
          startDate,
          endDate,
        )
      : ongoingReport
        ? await client.readMetricRange(
            ongoingReport.id,
            metric,
            startDate,
            endDate,
          )
        : undefined;
    if (value !== undefined) {
      values[metric] = value;
    } else if (!snapshotCoversMonth && ongoingReport) {
      inferZeroWhenPortfolioPublished[metric] = true;
    }
  }
  return {
    appAppleId: app.appAppleId,
    name: metadata.name,
    bundleId: app.bundleId,
    iconUrl: metadata.iconUrl,
    firstReleaseDate: metadata.firstReleaseDate,
    impressions: values.impressions,
    downloads: values.downloads,
    proceedsUsd: values.proceeds,
    impressionsAvailability:
      values.impressions === undefined ? "pending" : "available",
    downloadsAvailability:
      values.downloads === undefined ? "pending" : "available",
    proceedsAvailability:
      values.proceeds === undefined ? "pending" : "available",
    inferZeroWhenPortfolioPublished,
  };
}

function inferZeroActivityAfterPortfolioPublication(
  apps: CollectedMonthlyAppMetrics[],
): void {
  const fields = {
    impressions: ["impressions", "impressionsAvailability"],
    downloads: ["downloads", "downloadsAvailability"],
    proceeds: ["proceedsUsd", "proceedsAvailability"],
  } as const;
  for (const [metric, [valueField, availabilityField]] of Object.entries(
    fields,
  ) as Array<
    [
      AnalyticsMetric,
      readonly [
        "impressions" | "downloads" | "proceedsUsd",
        (
          | "impressionsAvailability"
          | "downloadsAvailability"
          | "proceedsAvailability"
        ),
      ],
    ]
  >) {
    if (!apps.some((app) => app[valueField] !== undefined)) {
      continue;
    }
    for (const app of apps) {
      if (
        app[valueField] === undefined &&
        app.inferZeroWhenPortfolioPublished[metric]
      ) {
        app[valueField] = 0;
        app[availabilityField] = "available";
      }
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      month: { type: "string" },
      "no-send": { type: "boolean", default: false },
      output: { type: "string" },
      "force-send": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values["no-send"] && values["force-send"]) {
    throw new Error("--force-send cannot be combined with --no-send");
  }
  const { startDate, endDate } = monthRange(values.month);
  const outputPath = path.resolve(
    values.output ?? outputPathForMonth(startDate, endDate),
  );
  const database = new AppDatabase();
  const shouldTrackDelivery = !values["no-send"];
  try {
    const previous = database.getMonthlyReportDelivery(startDate);
    if (
      shouldTrackDelivery &&
      !values["force-send"] &&
      previous?.deliveryStatus === "delivered"
    ) {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "already_delivered",
          monthStartDate: startDate,
          monthEndDate: endDate,
        }),
      );
      return;
    }
    if (
      shouldTrackDelivery &&
      !database.claimMonthlyReportDelivery(
        startDate,
        endDate,
        outputPath,
        values["force-send"],
      )
    ) {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "not_due_or_claimed",
          monthStartDate: startDate,
          monthEndDate: endDate,
        }),
      );
      return;
    }

    try {
      const apps = database.listApps(false);
      if (apps.length === 0) {
        throw new Error("No enabled apps are registered");
      }
      const client = new AppStoreAnalyticsClient(
        createAppStoreConnectToken(getAppStoreAnalyticsConfig()),
      );
      let setupClient: AppStoreAnalyticsClient | undefined;
      const getSetupClient = (): AppStoreAnalyticsClient => {
        setupClient ??= new AppStoreAnalyticsClient(
          createAppStoreConnectToken(getAppStoreAnalyticsSetupConfig()),
        );
        return setupClient;
      };
      const metrics: CollectedMonthlyAppMetrics[] = [];
      for (const app of apps) {
        metrics.push(
          await collectApp(client, getSetupClient, app, startDate, endDate),
        );
      }
      inferZeroActivityAfterPortfolioPublication(metrics);
      database.storePortfolioMetrics("monthly", startDate, endDate, metrics);
      const pendingMetrics = metrics.reduce(
        (sum, app) =>
          sum +
          [app.impressions, app.downloads, app.proceedsUsd].filter(
            (value) => value === undefined,
          ).length,
        0,
      );
      if (pendingMetrics > 0) {
        throw new AppleAnalyticsPendingError(
          `Apple has not published all monthly metrics for ${startDate} through ${endDate}; retrying later`,
        );
      }
      const report: MonthlyPortfolioReport = {
        monthStartDate: startDate,
        monthEndDate: endDate,
        generatedAt: new Date().toISOString(),
        timeZone: DAILY_REPORT_TIME_ZONE,
        apps: metrics,
      };
      const outputPaths = await renderMonthlyReportPng(report, outputPath);
      if (values["no-send"]) {
        console.log(
          JSON.stringify({
            monthStartDate: startDate,
            monthEndDate: endDate,
            outputPaths,
            sent: false,
          }),
        );
        return;
      }
      const messageIds = await sendTelegramPhotoGroup(
        outputPaths,
        monthlyReportCaption(report),
      );
      database.markMonthlyReportDelivered(startDate, messageIds[0]);
      console.log(
        JSON.stringify({
          monthStartDate: startDate,
          monthEndDate: endDate,
          outputPaths,
          sent: true,
          messageIds,
        }),
      );
    } catch (error) {
      if (shouldTrackDelivery) {
        const retryMs =
          error instanceof TelegramDeliveryError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1_000
            : 15 * 60 * 1_000;
        database.markMonthlyReportForRetry(
          startDate,
          error instanceof Error ? error.message : "Monthly report failed",
          Date.now() + retryMs,
        );
      }
      throw error;
    }
  } finally {
    database.close();
  }
}

main().catch((error) => {
  if (error instanceof AppleAnalyticsPendingError) {
    console.log(
      JSON.stringify({
        deferred: true,
        reason: "apple_data_pending",
        message: error.message,
      }),
    );
    return;
  }
  console.error(
    error instanceof Error ? error.message : "Monthly report failed",
  );
  process.exitCode = 1;
});
