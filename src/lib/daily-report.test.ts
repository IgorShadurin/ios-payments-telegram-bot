import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  previousCalendarDate,
  renderDailyReportPng,
  sortDailyAppMetrics,
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
  productPageViews: number | undefined,
): DailyAppMetrics {
  return {
    appAppleId: Math.floor(Math.random() * 1_000_000_000) + 1,
    name,
    bundleId: `com.example.${name.toLowerCase()}`,
    proceedsUsd,
    productPageViews,
    downloads: 1,
    viewsAvailability: productPageViews === undefined ? "pending" : "available",
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

  it("sorts by revenue, then by product-page views, with pending values last", () => {
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

  it("renders a valid PNG without requiring an icon", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "daily-report-"));
    directories.push(directory);
    const outputPath = path.join(directory, "report.png");
    await renderDailyReportPng(
      {
        reportDate: "2026-08-25",
        generatedAt: "2026-08-26T16:00:00.000Z",
        timeZone: "Europe/Minsk",
        apps: [app("Example", 4.99, 42)],
      },
      outputPath,
    );
    const bytes = readFileSync(outputPath);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.length).toBeGreaterThan(10_000);
  });
});
