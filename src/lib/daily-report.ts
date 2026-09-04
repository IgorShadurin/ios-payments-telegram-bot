import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { escapeTelegramHtml } from "./message";
import type {
  DailyAppMetrics,
  DailyPortfolioReport,
  MonthlyPortfolioReport,
  WeeklyPortfolioReport,
} from "./types";

export const DAILY_REPORT_TIME_ZONE = "Europe/Minsk";
export const DAILY_REPORT_LAG_DAYS = 4;

const WIDTH = 1240;
const CARD_HEIGHT = 174;
const CARD_GAP = 16;
const HEADER_HEIGHT = 370;
const CONTINUATION_HEADER_HEIGHT = 150;
const FOOTER_HEIGHT = 142;
const SIDE = 64;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
export const DAILY_REPORT_APPS_PER_PAGE = 10;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function estimatedTextWidth(value: string): number {
  return [...value].reduce((width, character) => {
    if (character === " ") return width + 7;
    if (/[ilI1.,:;'|]/.test(character)) return width + 8;
    if (/[MW@%&]/.test(character)) return width + 23;
    if (/[A-Z0-9]/.test(character)) return width + 17;
    return width + 14;
  }, 0);
}

function fitLine(value: string, maximumWidth: number): string {
  if (estimatedTextWidth(value) <= maximumWidth) return value;
  const characters = [...value];
  while (
    characters.length > 1 &&
    estimatedTextWidth(`${characters.join("")}…`) > maximumWidth
  ) {
    characters.pop();
  }
  return `${characters.join("").trimEnd()}…`;
}

function wrapAppName(value: string, maximumWidth = 330): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Untitled app"];
  const lines: string[] = [];
  for (const word of words) {
    const candidate = lines.length === 0 ? word : `${lines.at(-1)} ${word}`;
    if (lines.length === 0 || estimatedTextWidth(candidate) <= maximumWidth) {
      if (lines.length === 0) lines.push(candidate);
      else lines[lines.length - 1] = candidate;
      continue;
    }
    if (lines.length === 1) {
      lines.push(word);
      continue;
    }
    lines[1] = `${lines[1]} ${word}`;
  }
  return lines.slice(0, 2).map((line) => fitLine(line, maximumWidth));
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) < 1_000) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
      value,
    );
  }
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
  })
    .format(value)
    .replaceAll("K", "k")
    .replaceAll("M", "m")
    .replaceAll("B", "b")
    .replaceAll("T", "t");
}

function formatInteger(value: number | undefined, compact = false): string {
  if (value === undefined) {
    return "—";
  }
  return compact
    ? formatCompactNumber(value)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        value,
      );
}

function formatUsd(value: number | undefined, compact = false): string {
  if (value === undefined) {
    return "—";
  }
  if (compact && Math.abs(value) >= 1_000) {
    return `${value < 0 ? "-" : ""}$${formatCompactNumber(Math.abs(value))}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatReportDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatReportPeriod(startDate: string, endDate: string): string {
  const start = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${startDate}T12:00:00Z`));
  const end = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${endDate}T12:00:00Z`));
  return `${start} – ${end}`;
}

export function previousCalendarDate(
  now = new Date(),
  timeZone = DAILY_REPORT_TIME_ZONE,
): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function previousCompletedWeek(
  now = new Date(),
  timeZone = DAILY_REPORT_TIME_ZONE,
): { startDate: string; endDate: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
  const currentMonday = new Date(`${today}T12:00:00Z`);
  const daysSinceMonday = (currentMonday.getUTCDay() + 6) % 7;
  currentMonday.setUTCDate(currentMonday.getUTCDate() - daysSinceMonday);
  const start = new Date(currentMonday);
  start.setUTCDate(start.getUTCDate() - 7);
  const end = new Date(currentMonday);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export function previousCompletedMonth(
  now = new Date(),
  timeZone = DAILY_REPORT_TIME_ZONE,
): { startDate: string; endDate: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
  const currentMonth = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  const end = new Date(currentMonth);
  end.setUTCDate(0);
  return {
    startDate: `${end.toISOString().slice(0, 7)}-01`,
    endDate: end.toISOString().slice(0, 10),
  };
}

export function latestCompleteCalendarDate(
  now = new Date(),
  timeZone = DAILY_REPORT_TIME_ZONE,
): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(now);
  const complete = new Date(`${today}T12:00:00Z`);
  complete.setUTCDate(complete.getUTCDate() - DAILY_REPORT_LAG_DAYS);
  return complete.toISOString().slice(0, 10);
}

export function deliveryNeedsCompleteRefresh(
  reportDate: string,
  deliveredAt: number,
  timeZone = DAILY_REPORT_TIME_ZONE,
): boolean {
  const firstSafeDelivery = new Date(`${reportDate}T12:00:00Z`);
  firstSafeDelivery.setUTCDate(
    firstSafeDelivery.getUTCDate() + DAILY_REPORT_LAG_DAYS,
  );
  const deliveredDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(deliveredAt));
  return deliveredDate < firstSafeDelivery.toISOString().slice(0, 10);
}

export function sortDailyAppMetrics(
  apps: readonly DailyAppMetrics[],
): DailyAppMetrics[] {
  return [...apps].sort((left, right) => {
    const revenue =
      (right.proceedsUsd ?? Number.NEGATIVE_INFINITY) -
      (left.proceedsUsd ?? Number.NEGATIVE_INFINITY);
    if (revenue !== 0) {
      return revenue;
    }
    const impressions =
      (right.impressions ?? Number.NEGATIVE_INFINITY) -
      (left.impressions ?? Number.NEGATIVE_INFINITY);
    if (impressions !== 0) {
      return impressions;
    }
    return left.name.localeCompare(right.name);
  });
}

const MAX_DISPLAYED_INCREASE_PERCENT = 999;

function percentageChange(
  current: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (current === undefined || previous === undefined || previous <= 0) {
    return undefined;
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return change > MAX_DISPLAYED_INCREASE_PERCENT ? undefined : change;
}

export function addMetricComparisons(
  apps: readonly DailyAppMetrics[],
  previousApps: readonly DailyAppMetrics[],
  comparisonPeriodStartDate?: string,
): DailyAppMetrics[] {
  const previousByAppleId = new Map(
    previousApps.map((app) => [app.appAppleId, app]),
  );
  return apps.map((app) => {
    const previous = previousByAppleId.get(app.appAppleId);
    const firstReleaseDate = app.firstReleaseDate ?? previous?.firstReleaseDate;
    const hasCompleteBaseline =
      !comparisonPeriodStartDate ||
      !firstReleaseDate ||
      firstReleaseDate < comparisonPeriodStartDate;
    return {
      ...app,
      impressionsChangePercent: hasCompleteBaseline
        ? percentageChange(app.impressions, previous?.impressions)
        : undefined,
      downloadsChangePercent: hasCompleteBaseline
        ? percentageChange(app.downloads, previous?.downloads)
        : undefined,
      proceedsChangePercent: hasCompleteBaseline
        ? percentageChange(app.proceedsUsd, previous?.proceedsUsd)
        : undefined,
    };
  });
}

function abbreviatedTelegramAppName(
  name: string,
  maximumEscapedLength: number,
): string {
  const escapedName = escapeTelegramHtml(name);
  if (escapedName.length <= maximumEscapedLength) {
    return escapedName;
  }
  let abbreviated = "";
  for (const character of name) {
    const escapedCharacter = escapeTelegramHtml(character);
    if (
      abbreviated.length + escapedCharacter.length + 1 >
      maximumEscapedLength
    ) {
      break;
    }
    abbreviated += escapedCharacter;
  }
  return `${abbreviated.trimEnd()}…`;
}

function metricLeaders(
  apps: readonly DailyAppMetrics[],
  metric: "impressions" | "downloads",
): Array<DailyAppMetrics & Record<typeof metric, number>> {
  return apps
    .filter(
      (app): app is DailyAppMetrics & Record<typeof metric, number> =>
        app[metric] !== undefined,
    )
    .sort(
      (left, right) =>
        right[metric] - left[metric] ||
        (right.impressions ?? Number.NEGATIVE_INFINITY) -
          (left.impressions ?? Number.NEGATIVE_INFINITY) ||
        left.name.localeCompare(right.name) ||
        left.appAppleId - right.appAppleId,
    )
    .slice(0, 10);
}

function metricLeadersSection(
  heading: string,
  leaders: readonly (DailyAppMetrics & {
    impressions?: number;
    downloads?: number;
  })[],
  metric: "impressions" | "downloads",
  maximumNameLength: number,
  compactValues = false,
): string {
  if (leaders.length === 0) {
    return "";
  }
  const changeField =
    metric === "impressions"
      ? "impressionsChangePercent"
      : "downloadsChangePercent";
  return `\n\n<b>${heading}</b>\n${leaders
    .map((app, index) => {
      const change = app[changeField];
      const changeLabel =
        change === undefined ? "" : ` (${change > 0 ? "+" : ""}${change}%)`;
      return `${index + 1}. ${formatInteger(
        app[metric] ?? 0,
        compactValues,
      )}${changeLabel} - ${abbreviatedTelegramAppName(
        app.name,
        maximumNameLength,
      )}`;
    })
    .join("\n")}`;
}

export function dailyReportCaption(report: DailyPortfolioReport): string {
  const apps = sortDailyAppMetrics(report.apps);
  const revenue = apps.reduce((sum, app) => sum + (app.proceedsUsd ?? 0), 0);
  const pending = apps.reduce(
    (sum, app) =>
      sum +
      [app.impressions, app.downloads, app.proceedsUsd].filter(
        (value) => value === undefined,
      ).length,
    0,
  );
  const pendingLine =
    pending > 0 ? `\n🟠 ${pending} metrics pending from Apple` : "";
  const topImpressions = metricLeaders(apps, "impressions");
  const topDownloads = metricLeaders(apps, "downloads");
  const heading = `<b>📊 Daily App Store report</b>\n${escapeTelegramHtml(report.reportDate)} · ${apps.length} apps · ${escapeTelegramHtml(
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(revenue),
  )} proceeds${pendingLine}`;
  for (
    let maximumNameLength = 100;
    maximumNameLength >= 8;
    maximumNameLength -= 1
  ) {
    const caption = `${heading}${metricLeadersSection(
      "Top Impressions",
      topImpressions,
      "impressions",
      maximumNameLength,
    )}${metricLeadersSection(
      "Top Downloads",
      topDownloads,
      "downloads",
      maximumNameLength,
    )}`;
    if (caption.length <= 1_024) {
      return caption;
    }
  }
  throw new Error(
    "Daily report caption exceeds Telegram's 1,024-character limit",
  );
}

export function weeklyReportCaption(report: WeeklyPortfolioReport): string {
  const apps = sortDailyAppMetrics(report.apps);
  const revenue = apps.reduce((sum, app) => sum + (app.proceedsUsd ?? 0), 0);
  const pending = apps.reduce(
    (sum, app) =>
      sum +
      [app.impressions, app.downloads, app.proceedsUsd].filter(
        (value) => value === undefined,
      ).length,
    0,
  );
  const pendingLine =
    pending > 0 ? `\n🟠 ${pending} metrics pending from Apple` : "";
  const topImpressions = metricLeaders(apps, "impressions");
  const topDownloads = metricLeaders(apps, "downloads");
  const heading = `<b>🗓 Weekly App Store report</b>\n${escapeTelegramHtml(
    `${report.weekStartDate} – ${report.weekEndDate}`,
  )} · ${apps.length} apps · ${escapeTelegramHtml(
    formatUsd(revenue, true),
  )} proceeds${pendingLine}`;
  for (
    let maximumNameLength = 100;
    maximumNameLength >= 8;
    maximumNameLength -= 1
  ) {
    const caption = `${heading}${metricLeadersSection(
      "Top Impressions",
      topImpressions,
      "impressions",
      maximumNameLength,
      true,
    )}${metricLeadersSection(
      "Top Downloads",
      topDownloads,
      "downloads",
      maximumNameLength,
      true,
    )}`;
    if (caption.length <= 1_024) {
      return caption;
    }
  }
  throw new Error(
    "Weekly report caption exceeds Telegram's 1,024-character limit",
  );
}

export function monthlyReportCaption(report: MonthlyPortfolioReport): string {
  const apps = sortDailyAppMetrics(report.apps);
  const revenue = apps.reduce((sum, app) => sum + (app.proceedsUsd ?? 0), 0);
  const pending = apps.reduce(
    (sum, app) =>
      sum +
      [app.impressions, app.downloads, app.proceedsUsd].filter(
        (value) => value === undefined,
      ).length,
    0,
  );
  const pendingLine =
    pending > 0 ? `\n🟠 ${pending} metrics pending from Apple` : "";
  const topImpressions = metricLeaders(apps, "impressions");
  const topDownloads = metricLeaders(apps, "downloads");
  const heading = `<b>📅 Monthly App Store report</b>\n${escapeTelegramHtml(
    `${report.monthStartDate} – ${report.monthEndDate}`,
  )} · ${apps.length} apps · ${escapeTelegramHtml(
    formatUsd(revenue, true),
  )} proceeds${pendingLine}`;
  for (
    let maximumNameLength = 100;
    maximumNameLength >= 8;
    maximumNameLength -= 1
  ) {
    const caption = `${heading}${metricLeadersSection(
      "Top Impressions",
      topImpressions,
      "impressions",
      maximumNameLength,
      true,
    )}${metricLeadersSection(
      "Top Downloads",
      topDownloads,
      "downloads",
      maximumNameLength,
      true,
    )}`;
    if (caption.length <= 1_024) {
      return caption;
    }
  }
  throw new Error(
    "Monthly report caption exceeds Telegram's 1,024-character limit",
  );
}

export function paginateDailyAppMetrics(
  apps: readonly DailyAppMetrics[],
  pageSize = DAILY_REPORT_APPS_PER_PAGE,
): DailyAppMetrics[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Daily report page size must be a positive integer");
  }
  const sorted = sortDailyAppMetrics(apps);
  const pages: DailyAppMetrics[][] = [];
  for (let index = 0; index < sorted.length; index += pageSize) {
    pages.push(sorted.slice(index, index + pageSize));
  }
  return pages.length > 0 ? pages : [[]];
}

function pagedOutputPaths(outputPath: string, pageCount: number): string[] {
  if (pageCount === 1) {
    return [outputPath];
  }
  const extension = path.extname(outputPath) || ".png";
  const base = outputPath.slice(
    0,
    outputPath.length - path.extname(outputPath).length,
  );
  return Array.from(
    { length: pageCount },
    (_, index) => `${base}-page-${index + 1}-of-${pageCount}${extension}`,
  );
}

async function iconDataUrl(
  iconUrl: string | undefined,
  fetchImplementation: typeof fetch,
): Promise<string | undefined> {
  if (!iconUrl) {
    return undefined;
  }
  try {
    const url = new URL(iconUrl);
    if (url.protocol !== "https:") {
      return undefined;
    }
    const response = await fetchImplementation(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_ICON_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ICON_BYTES) {
      return undefined;
    }
    const normalized = await sharp(bytes)
      .resize(112, 112, { fit: "cover" })
      .png()
      .toBuffer();
    return `data:image/png;base64,${normalized.toString("base64")}`;
  } catch {
    return undefined;
  }
}

function pendingDot(value: number | undefined, x: number, y: number): string {
  return value === undefined
    ? `<circle cx="${x}" cy="${y}" r="5" fill="#F59E0B"/>`
    : "";
}

function appCard(
  app: DailyAppMetrics,
  rank: number,
  y: number,
  embeddedIcon?: string,
  compactValues = false,
): string {
  const nameLines = wrapAppName(app.name);
  const hasWrappedName = nameLines.length > 1;
  const nameY = y + (hasWrappedName ? 52 : 67);
  const bundleY = y + (hasWrappedName ? 116 : 101);
  const storeIdY = y + (hasWrappedName ? 145 : 132);
  const name = nameLines
    .map(
      (line, index) =>
        `<tspan x="240" dy="${index === 0 ? 0 : 29}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const bundle = fitLine(app.bundleId, 330);
  const icon = embeddedIcon
    ? `<image x="100" y="${y + 31}" width="112" height="112" href="${embeddedIcon}" preserveAspectRatio="xMidYMid slice" clip-path="url(#iconClip${rank})"/>`
    : `<rect x="100" y="${y + 31}" width="112" height="112" rx="25" fill="url(#fallbackGradient)"/><text x="156" y="${y + 102}" text-anchor="middle" class="fallbackLetter">${escapeXml(app.name.slice(0, 1).toUpperCase())}</text>`;
  return `
    <g>
      <rect x="${SIDE}" y="${y}" width="${WIDTH - SIDE * 2}" height="${CARD_HEIGHT}" rx="28" fill="#FFFFFF" stroke="#E9EDF3"/>
      <defs>
        <clipPath id="iconClip${rank}"><rect x="100" y="${y + 31}" width="112" height="112" rx="25"/></clipPath>
        <clipPath id="textClip${rank}"><rect x="236" y="${y + 26}" width="343" height="128"/></clipPath>
      </defs>
      <rect x="78" y="${y + 18}" width="34" height="34" rx="17" fill="#121826"/>
      <text x="95" y="${y + 41}" text-anchor="middle" class="rank">${rank}</text>
      ${icon}
      <g clip-path="url(#textClip${rank})">
        <text x="240" y="${nameY}" class="appName">${name}</text>
        <text x="240" y="${bundleY}" class="bundle">${escapeXml(bundle)}</text>
        <text x="240" y="${storeIdY}" class="storeId">APP STORE ID ${app.appAppleId}</text>
      </g>
      <line x1="595" y1="${y + 37}" x2="595" y2="${y + 137}" stroke="#E9EDF3"/>
      <text x="670" y="${y + 61}" class="metricLabel">IMPRESSIONS</text>
      ${pendingDot(app.impressions, 649, y + 56)}
      <text x="649" y="${y + 111}" class="metricValue">${formatInteger(app.impressions, compactValues)}</text>
      <text x="850" y="${y + 61}" class="metricLabel">DOWNLOADS</text>
      ${pendingDot(app.downloads, 829, y + 56)}
      <text x="829" y="${y + 111}" class="metricValue">${formatInteger(app.downloads, compactValues)}</text>
      <rect x="996" y="${y + 32}" width="180" height="110" rx="22" fill="#F0FDF4"/>
      <text x="1021" y="${y + 62}" class="earningsLabel">EARNINGS</text>
      ${pendingDot(app.proceedsUsd, 1008, y + 57)}
      <text x="1021" y="${y + 111}" class="earningsValue">${formatUsd(app.proceedsUsd, compactValues)}</text>
    </g>`;
}

interface PortfolioRenderOptions {
  title: string;
  periodLabel: string;
  periodPrefix: string;
  periodText: string;
  compactValues: boolean;
  availabilityFooter: string;
  manifestPeriod: Record<string, string>;
}

async function renderPortfolioReportPng(
  report: DailyPortfolioReport,
  outputPath: string,
  fetchImplementation: typeof fetch,
  options: PortfolioRenderOptions,
): Promise<string[]> {
  const apps = sortDailyAppMetrics(report.apps);
  const pages = paginateDailyAppMetrics(apps);
  const outputPaths = pagedOutputPaths(outputPath, pages.length);
  const iconUrls = await Promise.all(
    apps.map((app) => iconDataUrl(app.iconUrl, fetchImplementation)),
  );
  const totalImpressions = apps.reduce(
    (sum, app) => sum + (app.impressions ?? 0),
    0,
  );
  const totalDownloads = apps.reduce(
    (sum, app) => sum + (app.downloads ?? 0),
    0,
  );
  const totalProceeds = apps.reduce(
    (sum, app) => sum + (app.proceedsUsd ?? 0),
    0,
  );
  const availableImpressions = apps.filter(
    (app) => app.impressions !== undefined,
  ).length;
  const availableDownloads = apps.filter(
    (app) => app.downloads !== undefined,
  ).length;
  const availableProceeds = apps.filter(
    (app) => app.proceedsUsd !== undefined,
  ).length;
  const totalImpressionsLabel =
    availableImpressions === 0
      ? "—"
      : formatInteger(totalImpressions, options.compactValues);
  const totalDownloadsLabel =
    availableDownloads === 0
      ? "—"
      : formatInteger(totalDownloads, options.compactValues);
  const totalProceedsLabel =
    availableProceeds === 0
      ? "—"
      : formatUsd(totalProceeds, options.compactValues);
  const iconByAppleId = new Map(
    apps.map((app, index) => [app.appAppleId, iconUrls[index]]),
  );
  const rankByAppleId = new Map(
    apps.map((app, index) => [app.appAppleId, index + 1]),
  );
  const sampleLabel = report.isSample ? "SAMPLE DATA" : options.periodLabel;

  await fs.mkdir(path.dirname(outputPath), { recursive: true, mode: 0o750 });
  for (const [pageIndex, pageApps] of pages.entries()) {
    const isFirstPage = pageIndex === 0;
    const contentTop = isFirstPage ? HEADER_HEIGHT : CONTINUATION_HEADER_HEIGHT;
    const height =
      contentTop + pageApps.length * (CARD_HEIGHT + CARD_GAP) + FOOTER_HEIGHT;
    const cards = pageApps
      .map((app, index) =>
        appCard(
          app,
          rankByAppleId.get(app.appAppleId) ??
            pageIndex * DAILY_REPORT_APPS_PER_PAGE + index + 1,
          contentTop + index * (CARD_HEIGHT + CARD_GAP),
          iconByAppleId.get(app.appAppleId),
          options.compactValues,
        ),
      )
      .join("");
    const pageLabel = `PAGE ${pageIndex + 1} OF ${pages.length}`;
    const header = isFirstPage
      ? `
    <rect x="${SIDE}" y="40" width="${WIDTH - SIDE * 2}" height="294" rx="34" fill="url(#hero)"/>
    <rect x="96" y="75" width="176" height="34" rx="17" fill="#064E3B"/>
    <text x="184" y="98" text-anchor="middle" class="eyebrow" style="font-size:13px">${sampleLabel}</text>
    <rect x="975" y="75" width="135" height="34" rx="17" fill="#FFFFFF" fill-opacity="0.1"/>
    <text x="1042" y="98" text-anchor="middle" class="pageNumber">${pageLabel}</text>
    <text x="96" y="159" class="title">${escapeXml(options.title)}</text>
    <text x="96" y="198" class="date">${escapeXml(options.periodPrefix)} · ${escapeXml(options.periodText)} · ${apps.length} public apps</text>
    <rect x="96" y="225" width="326" height="80" rx="20" fill="#FFFFFF" fill-opacity="0.07"/>
    <text x="119" y="251" class="summaryLabel">IMPRESSIONS</text>
    <text x="119" y="289" class="summaryValue">${totalImpressionsLabel}</text>
    <text x="398" y="288" text-anchor="end" class="coverage">${availableImpressions}/${apps.length} ready</text>
    <rect x="440" y="225" width="326" height="80" rx="20" fill="#FFFFFF" fill-opacity="0.07"/>
    <text x="463" y="251" class="summaryLabel">DOWNLOADS</text>
    <text x="463" y="289" class="summaryValue">${totalDownloadsLabel}</text>
    <text x="742" y="288" text-anchor="end" class="coverage">${availableDownloads}/${apps.length} ready</text>
    <rect x="784" y="225" width="326" height="80" rx="20" fill="#10B981" fill-opacity="0.15"/>
    <text x="807" y="251" class="summaryLabel" style="fill:#A7F3D0">EARNINGS · PROCEEDS</text>
    <text x="807" y="289" class="summaryValue">${totalProceedsLabel}</text>
    <text x="1086" y="288" text-anchor="end" class="coverage">${availableProceeds}/${apps.length} ready</text>`
      : `
    <text x="${SIDE}" y="79" class="continuationDate">${escapeXml(options.periodPrefix)} · ${escapeXml(options.periodText)}</text>
    <rect x="1031" y="49" width="145" height="46" rx="23" fill="#172033"/>
    <text x="1103" y="78" text-anchor="middle" class="pageNumber">${pageLabel}</text>
    <line x1="${SIDE}" y1="118" x2="${WIDTH - SIDE}" y2="118" stroke="#DCE3EC" stroke-width="2"/>`;
    const svg = `
  <svg width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#F8FAFC"/><stop offset="1" stop-color="#F1F5F9"/></linearGradient>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#121826"/><stop offset="1" stop-color="#283548"/></linearGradient>
      <linearGradient id="fallbackGradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60A5FA"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient>
      <style>
        text { font-family: "DejaVu Sans", Arial, sans-serif; }
        .eyebrow { font-size: 18px; font-weight: 700; letter-spacing: 2.8px; fill: #A7F3D0; }
        .title { font-size: 45px; font-weight: 760; fill: #FFFFFF; }
        .date { font-size: 21px; font-weight: 500; fill: #CBD5E1; }
        .summaryLabel { font-size: 15px; font-weight: 700; letter-spacing: 1.3px; fill: #94A3B8; }
        .summaryValue { font-size: 38px; font-weight: 760; fill: #FFFFFF; }
        .coverage { font-size: 13px; font-weight: 600; fill: #94A3B8; }
        .rank { font-size: 16px; font-weight: 800; fill: #FFFFFF; }
        .fallbackLetter { font-size: 47px; font-weight: 800; fill: #FFFFFF; }
        .appName { font-size: 24px; font-weight: 730; fill: #172033; }
        .bundle { font-size: 16px; font-weight: 500; fill: #64748B; }
        .storeId { font-size: 13px; font-weight: 700; letter-spacing: 1.1px; fill: #94A3B8; }
        .metricLabel, .earningsLabel { font-size: 14px; font-weight: 750; letter-spacing: 1.1px; fill: #64748B; }
        .metricValue { font-size: 33px; font-weight: 760; fill: #172033; }
        .earningsValue { font-size: 31px; font-weight: 780; fill: #15803D; }
        .footer { font-size: 15px; font-weight: 520; fill: #64748B; }
        .pageNumber { font-size: 13px; font-weight: 800; letter-spacing: 1px; fill: #FFFFFF; }
        .continuationDate { font-size: 24px; font-weight: 700; fill: #172033; }
      </style>
    </defs>
    <rect width="${WIDTH}" height="${height}" fill="url(#background)"/>
    ${header}
    ${cards}
    <circle cx="80" cy="${height - 94}" r="5" fill="#F59E0B"/>
    <text x="96" y="${height - 89}" class="footer">Orange dots mean Apple has not published that metric yet.</text>
    <text x="96" y="${height - 60}" class="footer">${escapeXml(options.availabilityFooter)}</text>
    <text x="96" y="${height - 29}" class="footer">Sorted by earnings, then impressions · Earnings are estimated proceeds in USD · Generated ${escapeXml(report.generatedAt)}</text>
  </svg>`;

    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9 })
      .toFile(outputPaths[pageIndex]);
  }

  const manifestPath = `${outputPath.slice(0, outputPath.length - path.extname(outputPath).length)}.manifest.json`;
  await fs.writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        reportDate: report.reportDate,
        ...options.manifestPeriod,
        generatedAt: report.generatedAt,
        appCount: apps.length,
        appsPerPage: DAILY_REPORT_APPS_PER_PAGE,
        pageCount: pages.length,
        sort: ["proceedsUsd:desc", "impressions:desc"],
        pages: outputPaths.map((pagePath, index) => ({
          page: index + 1,
          file: path.basename(pagePath),
          appAppleIds: pages[index].map((app) => app.appAppleId),
        })),
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o640 },
  );
  return outputPaths;
}

export async function renderDailyReportPng(
  report: DailyPortfolioReport,
  outputPath: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string[]> {
  return renderPortfolioReportPng(report, outputPath, fetchImplementation, {
    title: "App portfolio report",
    periodLabel: "PREVIOUS DAY",
    periodPrefix: "REPORT DATE",
    periodText: formatReportDate(report.reportDate),
    compactValues: false,
    availabilityFooter:
      "Uses the latest Apple daily partitions. Previous-day metrics are provisional and may change for up to 3 days.",
    manifestPeriod: {},
  });
}

export async function renderWeeklyReportPng(
  report: WeeklyPortfolioReport,
  outputPath: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string[]> {
  return renderPortfolioReportPng(
    {
      reportDate: report.weekEndDate,
      generatedAt: report.generatedAt,
      timeZone: report.timeZone,
      apps: report.apps,
      isSample: report.isSample,
    },
    outputPath,
    fetchImplementation,
    {
      title: "Weekly portfolio report",
      periodLabel: "PREVIOUS WEEK",
      periodPrefix: "WEEK",
      periodText: formatReportPeriod(report.weekStartDate, report.weekEndDate),
      compactValues: true,
      availabilityFooter:
        "Aggregated from Apple's latest daily partitions. Recent values may change for up to 3 days.",
      manifestPeriod: {
        weekStartDate: report.weekStartDate,
        weekEndDate: report.weekEndDate,
      },
    },
  );
}

export async function renderMonthlyReportPng(
  report: MonthlyPortfolioReport,
  outputPath: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<string[]> {
  return renderPortfolioReportPng(
    {
      reportDate: report.monthEndDate,
      generatedAt: report.generatedAt,
      timeZone: report.timeZone,
      apps: report.apps,
      isSample: report.isSample,
    },
    outputPath,
    fetchImplementation,
    {
      title: "Monthly portfolio report",
      periodLabel: "PREVIOUS MONTH",
      periodPrefix: "MONTH",
      periodText: formatReportPeriod(
        report.monthStartDate,
        report.monthEndDate,
      ),
      compactValues: true,
      availabilityFooter:
        "Aggregated from Apple's latest daily partitions for the complete calendar month.",
      manifestPeriod: {
        monthStartDate: report.monthStartDate,
        monthEndDate: report.monthEndDate,
      },
    },
  );
}
