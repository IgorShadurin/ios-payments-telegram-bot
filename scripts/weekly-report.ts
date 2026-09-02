import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
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
  previousCompletedWeek,
  renderWeeklyReportPng,
  weeklyReportCaption,
} from "../src/lib/daily-report";
import { AppDatabase } from "../src/lib/database";
import {
  sendTelegramPhotoGroup,
  TelegramDeliveryError,
} from "../src/lib/telegram";
import type {
  DailyAppMetrics,
  RegisteredApp,
  WeeklyPortfolioReport,
} from "../src/lib/types";

type CollectedWeeklyAppMetrics = DailyAppMetrics & {
  inferZeroWhenPortfolioPublished: Partial<Record<AnalyticsMetric, boolean>>;
};

function addUtcCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekRange(weekStartInput?: string): {
  startDate: string;
  endDate: string;
} {
  if (!weekStartInput) {
    return previousCompletedWeek();
  }
  const startDate = z.iso.date().parse(weekStartInput);
  if (new Date(`${startDate}T12:00:00Z`).getUTCDay() !== 1) {
    throw new Error("--week-start must be a Monday");
  }
  return { startDate, endDate: addUtcCalendarDays(startDate, 6) };
}

function outputPathForWeek(startDate: string, endDate: string): string {
  const configured = process.env.DAILY_REPORT_OUTPUT_DIR?.trim();
  const directory =
    configured || path.join(path.dirname(getDatabasePath()), "reports");
  return path.join(
    directory,
    `weekly-app-portfolio-${startDate}-to-${endDate}.png`,
  );
}

async function collectApp(
  client: AppStoreAnalyticsClient,
  getSetupClient: () => AppStoreAnalyticsClient,
  app: RegisteredApp,
  startDate: string,
  endDate: string,
): Promise<CollectedWeeklyAppMetrics> {
  const metadata = await fetchPublicAppMetadata(app);
  const request = await client.ensureOngoingReportRequest(
    app.appAppleId,
    getSetupClient,
  );
  if (request.created) {
    console.log(
      `${app.bundleId}: ongoing analytics requested; weekly metrics pending from Apple`,
    );
    return {
      appAppleId: app.appAppleId,
      name: metadata.name,
      bundleId: app.bundleId,
      iconUrl: metadata.iconUrl,
      impressionsAvailability: "pending",
      downloadsAvailability: "pending",
      proceedsAvailability: "pending",
      inferZeroWhenPortfolioPublished: {},
    };
  }
  const reports = await client.listRequiredReports(request.id);
  const values: Partial<Record<AnalyticsMetric, number>> = {};
  const inferZeroWhenPortfolioPublished: Partial<
    Record<AnalyticsMetric, boolean>
  > = {};
  for (const metric of ["impressions", "downloads", "proceeds"] as const) {
    const report = reports[metric];
    if (report) {
      const value = await client.readMetricRange(
        report.id,
        metric,
        startDate,
        endDate,
      );
      if (value !== undefined) {
        values[metric] = value;
      } else {
        inferZeroWhenPortfolioPublished[metric] = true;
      }
    }
  }
  return {
    appAppleId: app.appAppleId,
    name: metadata.name,
    bundleId: app.bundleId,
    iconUrl: metadata.iconUrl,
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
  apps: CollectedWeeklyAppMetrics[],
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
      "week-start": { type: "string" },
      "no-send": { type: "boolean", default: false },
      output: { type: "string" },
      "force-send": { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values["no-send"] && values["force-send"]) {
    throw new Error("--force-send cannot be combined with --no-send");
  }
  const { startDate, endDate } = weekRange(values["week-start"]);
  const outputPath = path.resolve(
    values.output ?? outputPathForWeek(startDate, endDate),
  );
  const database = new AppDatabase();
  const shouldTrackDelivery = !values["no-send"];
  try {
    const previous = database.getWeeklyReportDelivery(startDate);
    if (
      shouldTrackDelivery &&
      !values["force-send"] &&
      previous?.deliveryStatus === "delivered"
    ) {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "already_delivered",
          weekStartDate: startDate,
          weekEndDate: endDate,
        }),
      );
      return;
    }
    if (
      shouldTrackDelivery &&
      !database.claimWeeklyReportDelivery(
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
          weekStartDate: startDate,
          weekEndDate: endDate,
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
      const metrics: CollectedWeeklyAppMetrics[] = [];
      for (const app of apps) {
        metrics.push(
          await collectApp(client, getSetupClient, app, startDate, endDate),
        );
        console.log(`${app.bundleId}: weekly analytics collected`);
      }
      inferZeroActivityAfterPortfolioPublication(metrics);
      const pendingMetrics = metrics.reduce(
        (sum, app) =>
          sum +
          [app.impressions, app.downloads, app.proceedsUsd].filter(
            (value) => value === undefined,
          ).length,
        0,
      );
      if (pendingMetrics > 0) {
        throw new Error(
          `Apple has not published all weekly metrics for ${startDate} through ${endDate}; retrying later`,
        );
      }
      const report: WeeklyPortfolioReport = {
        weekStartDate: startDate,
        weekEndDate: endDate,
        generatedAt: new Date().toISOString(),
        timeZone: DAILY_REPORT_TIME_ZONE,
        apps: metrics,
      };
      const outputPaths = await renderWeeklyReportPng(report, outputPath);
      if (values["no-send"]) {
        console.log(
          JSON.stringify({
            weekStartDate: startDate,
            weekEndDate: endDate,
            outputPaths,
            sent: false,
          }),
        );
        return;
      }
      const messageIds = await sendTelegramPhotoGroup(
        outputPaths,
        weeklyReportCaption(report),
      );
      database.markWeeklyReportDelivered(startDate, messageIds[0]);
      console.log(
        JSON.stringify({
          weekStartDate: startDate,
          weekEndDate: endDate,
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
        database.markWeeklyReportForRetry(
          startDate,
          error instanceof Error ? error.message : "Weekly report failed",
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
  console.error(
    error instanceof Error ? error.message : "Weekly report failed",
  );
  process.exitCode = 1;
});
