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
  previousCalendarDate,
  renderDailyReportPng,
  sortDailyAppMetrics,
} from "../src/lib/daily-report";
import { AppDatabase } from "../src/lib/database";
import { escapeTelegramHtml } from "../src/lib/message";
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
    productPageViews: 311,
    downloads: 38,
    proceedsUsd: 54.72,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6759647731,
    name: "Video Compressor: Target Size",
    bundleId: "com.shadurin.videocompressor",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/f8/33/b4/f833b43f-d66a-4d8f-d77e-eb22f7b50fcd/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    productPageViews: 684,
    downloads: 91,
    proceedsUsd: 21.45,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6791225542,
    name: "Text Brush Photo Video",
    bundleId: "com.shadurin.textbrush",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/fa/fb/63/fafb632e-6ef9-72c5-7f2c-d35344ffb636/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    productPageViews: 516,
    downloads: 67,
    proceedsUsd: 14.98,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6760296772,
    name: "MP3 WAV M4A Audio Converter",
    bundleId: "com.shadurin.audioconverter",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/08/30/0e/08300e9c-bfd3-16b0-8fe1-106f57d5914d/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    productPageViews: 238,
    downloads: 29,
    proceedsUsd: 9.96,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6796393323,
    name: "Audio Fade In & Out Editor",
    bundleId: "com.shadurin.audiofade",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/cd/23/d9/cd23d907-b30d-b964-468c-296a5bf96f7b/AppIcon-0-0-1x_U007emarketing-0-11-0-85-220.png/512x512bb.jpg",
    productPageViews: 196,
    downloads: 23,
    proceedsUsd: 4.99,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6797318750,
    name: "3D Photo Animator: Jelly",
    bundleId: "com.shadurin.jelly",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/b4/39/9a/b4399a2d-425d-83ef-5ec4-464d6c0e5783/AppIcon-0-0-1x_U007ephone-0-1-85-220.png/512x512bb.jpg",
    productPageViews: 143,
    downloads: 17,
    proceedsUsd: 0,
    viewsAvailability: "available",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
  {
    appAppleId: 6773920772,
    name: "Video Collage Grid Maker",
    bundleId: "com.lohinov.videocollage",
    iconUrl:
      "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/07/32/c2/0732c2ce-b310-e734-88aa-c95227bd8ffb/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg",
    productPageViews: 81,
    downloads: 9,
    proceedsUsd: 0,
    viewsAvailability: "available",
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
    viewsAvailability: "pending",
    downloadsAvailability: "available",
    proceedsAvailability: "available",
  },
];

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
): Promise<DailyAppMetrics> {
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
      viewsAvailability: "pending",
      downloadsAvailability: "pending",
      proceedsAvailability: "pending",
    };
  }
  const reports = await client.listRequiredReports(request.id);
  const values: Partial<Record<AnalyticsMetric, number>> = {};
  for (const metric of ["views", "downloads", "proceeds"] as const) {
    const report = reports[metric];
    if (report) {
      const value = await client.readMetric(report.id, metric, reportDate);
      if (value !== undefined) {
        values[metric] = value;
      }
    }
  }
  return {
    appAppleId: app.appAppleId,
    name: metadata.name,
    bundleId: app.bundleId,
    iconUrl: metadata.iconUrl,
    productPageViews: values.views,
    downloads: values.downloads,
    proceedsUsd: values.proceeds,
    viewsAvailability: values.views === undefined ? "pending" : "available",
    downloadsAvailability:
      values.downloads === undefined ? "pending" : "available",
    proceedsAvailability:
      values.proceeds === undefined ? "pending" : "available",
  };
}

function caption(report: DailyPortfolioReport): string {
  const apps = sortDailyAppMetrics(report.apps);
  const revenue = apps.reduce((sum, app) => sum + (app.proceedsUsd ?? 0), 0);
  const pending = apps.reduce(
    (sum, app) =>
      sum +
      [app.productPageViews, app.downloads, app.proceedsUsd].filter(
        (value) => value === undefined,
      ).length,
    0,
  );
  const pendingLine =
    pending > 0 ? `\n🟠 ${pending} metrics pending from Apple` : "";
  return `<b>📊 Daily App Store report</b>\n${escapeTelegramHtml(report.reportDate)} · ${apps.length} apps · ${escapeTelegramHtml(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(revenue),
  )} proceeds${pendingLine}`;
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
  try {
    const previous = database.getDailyReportDelivery(reportDate);
    if (shouldTrackDelivery && previous?.deliveryStatus === "delivered") {
      console.log(
        JSON.stringify({
          skipped: true,
          reason: "already_delivered",
          reportDate,
        }),
      );
      return;
    }
    if (
      shouldTrackDelivery &&
      !database.claimDailyReportDelivery(reportDate, outputPath)
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
      const metrics: DailyAppMetrics[] = [];
      for (const app of apps) {
        metrics.push(await collectApp(client, getSetupClient, app, reportDate));
        console.log(`${app.bundleId}: analytics collected`);
      }
      const report: DailyPortfolioReport = {
        reportDate,
        generatedAt: new Date().toISOString(),
        timeZone: DAILY_REPORT_TIME_ZONE,
        apps: metrics,
      };
      const outputPaths = await renderDailyReportPng(report, outputPath);
      if (values["no-send"]) {
        console.log(JSON.stringify({ reportDate, outputPaths, sent: false }));
        return;
      }
      const messageIds = await sendTelegramPhotoGroup(
        outputPaths,
        caption(report),
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
  console.error(error instanceof Error ? error.message : "Daily report failed");
  process.exitCode = 1;
});
