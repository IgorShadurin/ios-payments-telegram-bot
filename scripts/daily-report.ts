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
  addMetricComparisons,
  DAILY_REPORT_TIME_ZONE,
  dailyReportCaption,
  deliveryNeedsCompleteRefresh,
  previousCalendarDate,
  renderDailyReportPng,
} from "../src/lib/daily-report";
import { AppDatabase } from "../src/lib/database";
import {
  sendTelegramPhotoGroup,
  TelegramDeliveryError,
} from "../src/lib/telegram";
import type {
  DailyAppMetrics,
  DailyPortfolioReport,
  RegisteredApp,
} from "../src/lib/types";

const sampleApps: DailyAppMetrics[] = [
  {
    appAppleId: 6755393914,
    name: "Faceless Video Maker: YumCut",
    bundleId: "com.shadurin.yumcut",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/8e/5e/78/8e5e78a2-5196-45f8-bab9-35da59799b7a/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    impressions: 311,
    downloads: 38,
    proceedsUsd: 54.72,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6759647731,
    name: "Video Compressor: Target Size",
    bundleId: "com.shadurin.videocompressor",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/f8/33/b4/f833b43f-d66a-4d8f-d77e-eb22f7b50fcd/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    impressions: 684,
    downloads: 91,
    proceedsUsd: 21.45,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6791225542,
    name: "Text Brush Photo Video",
    bundleId: "com.shadurin.textbrush",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/fa/fb/63/fafb632e-6ef9-72c5-7f2c-d35344ffb636/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    impressions: 516,
    downloads: 67,
    proceedsUsd: 14.98,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6760296772,
    name: "MP3 WAV M4A Audio Converter",
    bundleId: "com.shadurin.audioconverter",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/08/30/0e/08300e9c-bfd3-16b0-8fe1-106f57d5914d/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    impressions: 238,
    downloads: 29,
    proceedsUsd: 9.96,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6796393323,
    name: "Audio Fade In & Out Editor",
    bundleId: "com.shadurin.audiofade",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cd/23/d9/cd23d907-b30d-b964-468c-296a5bf96f7b/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    impressions: 196,
    downloads: 23,
    proceedsUsd: 4.99,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6797318750,
    name: "3D Photo Animator: Jelly",
    bundleId: "com.shadurin.jelly",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b4/39/9a/b4399a2d-425d-83ef-5ec4-464d6c0e5783/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/512x512bb.jpg",
    impressions: 143,
    downloads: 17,
    proceedsUsd: 0,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6773920772,
    name: "Video Collage Grid Maker",
    bundleId: "com.lohinov.videocollage",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/07/32/c2/0732c2ce-b310-e734-88aa-c95227bd8ffb/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg",
    impressions: 81,
    downloads: 9,
    proceedsUsd: 0,
    impressionsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6796058476,
    name: "Audio Trimmer & Cutter",
    bundleId: "com.shadurin.audiotrimmer",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/68/23/b5/6823b5f5-a373-2f01-6881-a1d1ddee62be/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    downloads: 6,
    proceedsUsd: 0,
    impressionsAvailability: "pending",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
];

type CollectedDailyAppMetrics = DailyAppMetrics & {
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

function outputPathForDate(reportDate: string): string {
  const configured = process.env.DAILY_REPORT_OUTPUT_DIR?.trim();
  const directory =
    configured || path.join(path.dirname(getDatabasePath()), "reports");
  return path.join(directory, `app-portfolio-${reportDate}.png`);
}

async function collectApp(
  client: AppStoreAnalyticsClient,
  getSetupClient: () => AppStoreAnalyticsClient,
  app: RegisteredApp,
  reportDate: string,
): Promise<CollectedDailyAppMetrics> {
  const metadata = await fetchPublicAppMetadata(app);
  const request = await client.ensureOngoingReportRequest(
    app.appAppleId,
    getSetupClient,
  );
  if (request.created) {
    console.log(
      `${app.bundleId}: ongoing analytics requested; metrics pending from Apple`,
    );
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
  const reports = await client.listRequiredReports(request.id);
  const values: Partial<Record<AnalyticsMetric, number>> = {};
  const inferZeroWhenPortfolioPublished: Partial<
    Record<AnalyticsMetric, boolean>
  > = {};
  for (const metric of ["impressions", "downloads", "proceeds"] as const) {
    const report = reports[metric];
    if (report) {
      const value = await client.readMetric(report.id, metric, reportDate);
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
  apps: CollectedDailyAppMetrics[],
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

async function renderSample(
  reportDate: string,
  outputPath: string,
): Promise<void> {
  const report: DailyPortfolioReport = {
    reportDate,
    generatedAt: new Date().toISOString(),
    timeZone: DAILY_REPORT_TIME_ZONE,
    apps: sampleApps,
    isSample: true,
  };
  const outputPaths = await renderDailyReportPng(report, outputPath);
  console.log(JSON.stringify({ sample: true, reportDate, outputPaths }));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      sample: { type: "boolean", default: false },
      "no-send": { type: "boolean", default: false },
      date: { type: "string" },
      output: { type: "string" },
      "force-send": { type: "boolean", default: false },
    },
    strict: true,
  });
  const reportDate = values.date
    ? z.iso.date().parse(values.date)
    : previousCalendarDate();
  const outputPath = path.resolve(
    values.output ?? outputPathForDate(reportDate),
  );
  if (values.sample) {
    await renderSample(reportDate, outputPath);
    return;
  }

  const database = new AppDatabase();
  const shouldTrackDelivery = !values["no-send"];
  if (values["no-send"] && values["force-send"]) {
    throw new Error("--force-send cannot be combined with --no-send");
  }
  try {
    const previous = database.getDailyReportDelivery(reportDate);
    const needsCompleteRefresh =
      values.date !== undefined &&
      previous?.deliveryStatus === "delivered" &&
      previous.deliveredAt !== undefined &&
      deliveryNeedsCompleteRefresh(reportDate, previous.deliveredAt);
    if (
      shouldTrackDelivery &&
      !values["force-send"] &&
      !needsCompleteRefresh &&
      previous?.deliveryStatus === "delivered"
    ) {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "already_delivered",
          reportDate,
        }),
      );
      return;
    }
    if (shouldTrackDelivery && needsCompleteRefresh) {
      console.log(
        JSON.stringify({
          refreshing: true,
          reason: "previous_delivery_preceded_complete_partition",
          reportDate,
        }),
      );
    }
    if (
      shouldTrackDelivery &&
      !database.claimDailyReportDelivery(
        reportDate,
        outputPath,
        values["force-send"] || needsCompleteRefresh,
      )
    ) {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "not_due_or_claimed",
          reportDate,
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
      const metrics: CollectedDailyAppMetrics[] = [];
      for (const app of apps) {
        metrics.push(await collectApp(client, getSetupClient, app, reportDate));
      }
      inferZeroActivityAfterPortfolioPublication(metrics);
      database.storePortfolioMetrics("daily", reportDate, reportDate, metrics);
      const entirelyPendingMetrics = [
        ["impressions", metrics.every((app) => app.impressions === undefined)],
        ["downloads", metrics.every((app) => app.downloads === undefined)],
        ["proceeds", metrics.every((app) => app.proceedsUsd === undefined)],
      ]
        .filter(([, pending]) => pending)
        .map(([metric]) => metric);
      if (entirelyPendingMetrics.length > 0) {
        throw new AppleAnalyticsPendingError(
          `Apple has not published ${entirelyPendingMetrics.join(
            ", ",
          )} for ${reportDate}; retrying later`,
        );
      }
      const comparisonDate = addUtcCalendarDays(reportDate, -7);
      let previousMetrics = database.getPortfolioMetrics(
        "daily",
        comparisonDate,
      );
      const storedAppleIds = new Set(
        previousMetrics.map((app) => app.appAppleId),
      );
      const missingComparisonApps = apps.filter(
        (app) => !storedAppleIds.has(app.appAppleId),
      );
      if (missingComparisonApps.length > 0) {
        const collectedComparisonMetrics: CollectedDailyAppMetrics[] = [];
        for (const app of missingComparisonApps) {
          collectedComparisonMetrics.push(
            await collectApp(client, getSetupClient, app, comparisonDate),
          );
        }
        inferZeroActivityAfterPortfolioPublication(collectedComparisonMetrics);
        database.storePortfolioMetrics(
          "daily",
          comparisonDate,
          comparisonDate,
          collectedComparisonMetrics,
        );
        previousMetrics = database.getPortfolioMetrics("daily", comparisonDate);
      }
      const report: DailyPortfolioReport = {
        reportDate,
        generatedAt: new Date().toISOString(),
        timeZone: DAILY_REPORT_TIME_ZONE,
        apps: addMetricComparisons(metrics, previousMetrics, comparisonDate),
      };
      const outputPaths = await renderDailyReportPng(report, outputPath);
      if (values["no-send"]) {
        console.log(JSON.stringify({ reportDate, outputPaths, sent: false }));
        return;
      }
      const messageIds = await sendTelegramPhotoGroup(
        outputPaths,
        dailyReportCaption(report),
      );
      database.markDailyReportDelivered(reportDate, messageIds[0]);
      console.log(
        JSON.stringify({ reportDate, outputPaths, sent: true, messageIds }),
      );
    } catch (error) {
      if (shouldTrackDelivery) {
        const retryMs =
          error instanceof TelegramDeliveryError && error.retryAfterSeconds
            ? error.retryAfterSeconds * 1_000
            : 15 * 60 * 1_000;
        database.markDailyReportForRetry(
          reportDate,
          error instanceof Error ? error.message : "Daily report failed",
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
  console.error(error instanceof Error ? error.message : "Daily report failed");
  process.exitCode = 1;
});
