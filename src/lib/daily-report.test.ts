import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DAILY_REPORT_APPS_PER_PAGE,
  DAILY_REPORT_LAG_DAYS,
  dailyReportCaption,
  deliveryNeedsCompleteRefresh,
  latestCompleteCalendarDate,
  paginateDailyAppMetrics,
  previousCalendarDate,
  previousCompletedWeek,
  renderDailyReportPng,
  renderWeeklyReportPng,
  sortDailyAppMetrics,
  weeklyReportCaption,
} from "./daily-report";
import type { DailyAppMetrics } from "./types";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function app(
  name: string,
  proceedsUsd: number | undefined,
  impressions: number | undefined,
): DailyAppMetrics {
  return {
    appAppleId: Math.floor(Math.random() * 1_000_000_000) + 1,
    name,
    bundleId: `com.example.${name.toLowerCase()}`,
    proceedsUsd,
    impressions,
    downloads: 1,
    impressionsAvailability:
      impressions === undefined ? "pending" : "available",
    downloadsAvailability: "available",
    proceedsAvailability: proceedsUsd === undefined ? "pending" : "available",
  };
}

describe("daily report", () => {
  it("uses the previous Minsk calendar date", () => {
    expect(previousCalendarDate(new Date("2026-08-27T16:00:00Z"))).toBe(
      "2026-08-26",
    );
    expect(previousCalendarDate(new Date("2026-01-01T16:00:00Z"))).toBe(
      "2025-12-31",
    );
  });

  it("uses the previous completed Monday-to-Sunday week", () => {
    expect(previousCompletedWeek(new Date("2026-09-02T16:00:00Z"))).toEqual({
      startDate: "2026-08-24",
      endDate: "2026-08-30",
    });
    expect(previousCompletedWeek(new Date("2026-09-07T06:00:00Z"))).toEqual({
      startDate: "2026-08-31",
      endDate: "2026-09-06",
    });
  });

  it("can still calculate a conservative complete-data date", () => {
    expect(DAILY_REPORT_LAG_DAYS).toBe(4);
    expect(latestCompleteCalendarDate(new Date("2026-09-02T16:00:00Z"))).toBe(
      "2026-08-29",
    );
    expect(latestCompleteCalendarDate(new Date("2026-01-02T16:00:00Z"))).toBe(
      "2025-12-29",
    );
  });

  it("refreshes a report delivered before its complete-data day only once", () => {
    expect(
      deliveryNeedsCompleteRefresh(
        "2026-08-29",
        Date.parse("2026-08-30T16:00:00Z"),
      ),
    ).toBe(true);
    expect(
      deliveryNeedsCompleteRefresh(
        "2026-08-29",
        Date.parse("2026-09-02T16:00:00Z"),
      ),
    ).toBe(false);
  });

  it("sorts by revenue, then by impressions, with pending values last", () => {
    const sorted = sortDailyAppMetrics([
      app("Pending", undefined, 999),
      app("Views", 3, 40),
      app("Revenue", 8, 1),
      app("MoreViews", 3, 80),
    ]);
    expect(sorted.map((item) => item.name)).toEqual([
      "Revenue",
      "MoreViews",
      "Views",
      "Pending",
    ]);
  });

  it("adds numbered top-ten impression and download lists to the Telegram caption", () => {
    const apps = [
      app("Sixth", 1, 100),
      app("Third", 1, 300),
      app("First & Best", 1, 612),
      app("Pending", 1, undefined),
      app("Fifth", 1, 200),
      app("Second", 1, 390),
      app("Fourth", 1, 250),
    ];
    apps.forEach((item, index) => {
      item.downloads = index + 10;
    });

    expect(
      dailyReportCaption({
        reportDate: "2026-08-29",
        generatedAt: "2026-09-02T16:00:00.000Z",
        timeZone: "Europe/Minsk",
        apps,
      }),
    ).toBe(
      "<b>📊 Daily App Store report</b>\n" +
        "2026-08-29 · 7 apps · $7.00 proceeds\n" +
        "🟠 1 metrics pending from Apple\n\n" +
        "<b>Top Impressions</b>\n" +
        "1. 612 - First &amp; Best\n" +
        "2. 390 - Second\n" +
        "3. 300 - Third\n" +
        "4. 250 - Fourth\n" +
        "5. 200 - Fifth\n" +
        "6. 100 - Sixth\n\n" +
        "<b>Top Downloads</b>\n" +
        "1. 16 - Fourth\n" +
        "2. 15 - Second\n" +
        "3. 14 - Fifth\n" +
        "4. 13 - Pending\n" +
        "5. 12 - First &amp; Best\n" +
        "6. 11 - Third\n" +
        "7. 10 - Sixth",
    );
  });

  it("keeps two top-ten lists within Telegram's caption limit", () => {
    const apps = Array.from({ length: 25 }, (_, index) => {
      const item = app(
        `${"Very & Long App Name ".repeat(5)}${index}`,
        1,
        100 - index,
      );
      item.downloads = 200 - index;
      return item;
    });

    const caption = dailyReportCaption({
      reportDate: "2026-08-29",
      generatedAt: "2026-09-02T16:00:00.000Z",
      timeZone: "Europe/Minsk",
      apps,
    });
    expect(caption.length).toBeLessThanOrEqual(1_024);
    expect(caption).toContain("<b>Top Impressions</b>");
    expect(caption).toContain("<b>Top Downloads</b>");
    expect(caption).toContain("10. ");
  });

  it("formats a compact numbered weekly Telegram caption", () => {
    const leader = app("Weekly Leader", 2_500, 2_500);
    leader.downloads = 1_200;
    const caption = weeklyReportCaption({
      weekStartDate: "2026-08-24",
      weekEndDate: "2026-08-30",
      generatedAt: "2026-09-02T16:00:00.000Z",
      timeZone: "Europe/Minsk",
      apps: [leader],
    });
    expect(caption).toContain("<b>🗓 Weekly App Store report</b>");
    expect(caption).toContain("2026-08-24 – 2026-08-30");
    expect(caption).toContain("$2.5k proceeds");
    expect(caption).toContain("1. 2.5k - Weekly Leader");
    expect(caption).toContain("1. 1.2k - Weekly Leader");
  });

  it("renders a valid PNG without requiring an icon", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "daily-report-"));
    directories.push(directory);
    const outputPath = path.join(directory, "report.png");
    const paths = await renderDailyReportPng(
      {
        reportDate: "2026-08-25",
        generatedAt: "2026-08-26T16:00:00.000Z",
        timeZone: "Europe/Minsk",
        apps: [app("Example", 4.99, 42)],
      },
      outputPath,
    );
    expect(paths).toEqual([outputPath]);
    const bytes = readFileSync(outputPath);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(10_000);
  });

  it("globally sorts and splits apps into pages of ten", () => {
    const apps = Array.from({ length: 24 }, (_, index) =>
      app(`App${index + 1}`, index + 1, 100 - index),
    );
    const pages = paginateDailyAppMetrics(apps);
    expect(DAILY_REPORT_APPS_PER_PAGE).toBe(10);
    expect(pages.map((page) => page.length)).toEqual([10, 10, 4]);
    expect(pages.flat().map((item) => item.name)).toEqual(
      Array.from({ length: 24 }, (_, index) => `App${24 - index}`),
    );
  });

  it("renders numbered PNG pages when there are more than ten apps", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "daily-report-pages-"));
    directories.push(directory);
    const outputPath = path.join(directory, "report.png");
    const paths = await renderDailyReportPng(
      {
        reportDate: "2026-08-25",
        generatedAt: "2026-08-26T16:00:00.000Z",
        timeZone: "Europe/Minsk",
        apps: Array.from({ length: 11 }, (_, index) =>
          app(`Example${index + 1}`, index, 100 - index),
        ),
      },
      outputPath,
    );
    expect(paths.map((item) => path.basename(item))).toEqual([
      "report-page-1-of-2.png",
      "report-page-2-of-2.png",
    ]);
    for (const pagePath of paths) {
      const bytes = readFileSync(pagePath);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
    expect(
      JSON.parse(
        readFileSync(path.join(directory, "report.manifest.json"), "utf8"),
      ),
    ).toMatchObject({ appCount: 11, appsPerPage: 10, pageCount: 2 });
  });

  it("renders a weekly report with its date range in the manifest", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "weekly-report-"));
    directories.push(directory);
    const outputPath = path.join(directory, "weekly.png");
    const paths = await renderWeeklyReportPng(
      {
        weekStartDate: "2026-08-24",
        weekEndDate: "2026-08-30",
        generatedAt: "2026-09-02T16:00:00.000Z",
        timeZone: "Europe/Minsk",
        apps: [app("Weekly Example", 1_250, 12_500)],
      },
      outputPath,
    );
    expect(paths).toEqual([outputPath]);
    expect(
      JSON.parse(
        readFileSync(path.join(directory, "weekly.manifest.json"), "utf8"),
      ),
    ).toMatchObject({
      weekStartDate: "2026-08-24",
      weekEndDate: "2026-08-30",
      appCount: 1,
    });
  });
});
