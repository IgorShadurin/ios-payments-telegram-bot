import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";
import type { PaymentEvent } from "./types";

let directory: string;
let database: AppDatabase;

function event(notificationUuid: string): PaymentEvent {
  return {
    notificationUuid,
    notificationType: "DID_RENEW",
    subtype: "BILLING_RECOVERY",
    environment: "Sandbox",
    signedDate: 1_750_000_000_000,
    transactionId: "2000000123456789",
    originalTransactionId: "2000000123000000",
    productId: "premium.monthly",
    payload: { verified: true },
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ios-payments-db-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("AppDatabase", () => {
  it("registers, updates, disables, and enables apps", () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    expect(database.getAppByBundleId("com.example.app")).toEqual(app);

    const updated = database.updateApp("com.example.app", { name: "Renamed" });
    expect(updated?.name).toBe("Renamed");

    database.setAppEnabled("com.example.app", false);
    expect(database.getAppByBundleId("com.example.app")).toBeUndefined();
    expect(database.getAppByBundleId("com.example.app", true)?.enabled).toBe(
      false,
    );

    database.setAppEnabled("com.example.app", true);
    expect(database.getAppByBundleId("com.example.app")?.enabled).toBe(true);
  });

  it("deduplicates notifications by Apple's notification UUID", () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    const input = {
      appId: app.id,
      event: event("c1ba2fa0-a79a-4d4b-ab01-ef47456b8635"),
      messageHtml: "<b>Renewed</b>",
    };

    expect(database.insertNotification(input).created).toBe(true);
    expect(database.insertNotification(input).created).toBe(false);
    expect(database.recentNotifications()).toHaveLength(1);
  });

  it("claims a notification once and records a successful delivery", () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    const inserted = database.insertNotification({
      appId: app.id,
      event: event("ed6bb5ed-08fb-4c13-9991-e633378093ec"),
      messageHtml: "<b>Renewed</b>",
    }).notification;

    expect(database.claimNotification(inserted.id)?.deliveryStatus).toBe(
      "sending",
    );
    expect(database.claimNotification(inserted.id)).toBeUndefined();

    database.markDelivered(inserted.id, 42);
    expect(database.getNotificationById(inserted.id)).toMatchObject({
      deliveryStatus: "delivered",
      deliveryAttempts: 1,
      telegramMessageId: 42,
    });
  });

  it("keeps failed deliveries in the durable retry queue", () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    const inserted = database.insertNotification({
      appId: app.id,
      event: event("0799fac8-c8dc-44b4-91c8-9fd01a0b5110"),
      messageHtml: "<b>Renewed</b>",
    }).notification;

    database.claimNotification(inserted.id);
    database.markForRetry(
      inserted.id,
      "Temporary Telegram failure",
      Date.now() + 60_000,
    );

    expect(database.getNotificationById(inserted.id)).toMatchObject({
      deliveryStatus: "retry",
      deliveryAttempts: 1,
      lastError: "Temporary Telegram failure",
    });
    expect(database.pendingCount()).toBe(1);
  });

  it("stores registry messages in a durable Telegram outbox", () => {
    const queued = database.enqueueTelegramMessage(
      "registry:add:com.example.app:1",
      "app_registry",
      "<b>App registered</b>",
    );
    expect(queued.created).toBe(true);
    expect(
      database.enqueueTelegramMessage(
        "registry:add:com.example.app:1",
        "app_registry",
        "<b>App registered</b>",
      ).created,
    ).toBe(false);

    const claimed = database.claimTelegramOutboxMessage(queued.message.id);
    expect(claimed?.deliveryStatus).toBe("sending");
    database.markTelegramOutboxForRetry(
      queued.message.id,
      "Temporary failure",
      Date.now(),
    );
    expect(database.pendingTelegramOutboxCount()).toBe(1);

    expect(database.claimDueTelegramOutboxMessages(10)).toHaveLength(1);
    database.markTelegramOutboxDelivered(queued.message.id, 77);
    expect(
      database.getTelegramOutboxMessageById(queued.message.id),
    ).toMatchObject({
      deliveryStatus: "delivered",
      deliveryAttempts: 2,
      telegramMessageId: 77,
    });
  });

  it("claims and deduplicates a delivered daily report", () => {
    expect(
      database.claimDailyReportDelivery("2026-08-25", "/data/report.png"),
    ).toMatchObject({ deliveryStatus: "sending", deliveryAttempts: 0 });
    expect(
      database.claimDailyReportDelivery("2026-08-25", "/data/report.png"),
    ).toBeUndefined();

    database.markDailyReportDelivered("2026-08-25", 91);
    expect(database.getDailyReportDelivery("2026-08-25")).toMatchObject({
      deliveryStatus: "delivered",
      deliveryAttempts: 1,
      telegramMessageId: 91,
    });
    expect(
      database.claimDailyReportDelivery("2026-08-25", "/data/report.png"),
    ).toBeUndefined();

    expect(
      database.claimDailyReportDelivery(
        "2026-08-25",
        "/data/corrected-report.png",
        true,
      ),
    ).toMatchObject({
      deliveryStatus: "sending",
      telegramMessageId: undefined,
    });
  });

  it("claims and deduplicates a delivered weekly report", () => {
    expect(
      database.claimWeeklyReportDelivery(
        "2026-08-24",
        "2026-08-30",
        "/data/weekly.png",
      ),
    ).toMatchObject({
      weekStartDate: "2026-08-24",
      weekEndDate: "2026-08-30",
      deliveryStatus: "sending",
    });
    expect(
      database.claimWeeklyReportDelivery(
        "2026-08-24",
        "2026-08-30",
        "/data/weekly.png",
      ),
    ).toBeUndefined();

    database.markWeeklyReportDelivered("2026-08-24", 92);
    expect(database.getWeeklyReportDelivery("2026-08-24")).toMatchObject({
      deliveryStatus: "delivered",
      deliveryAttempts: 1,
      telegramMessageId: 92,
    });
  });

  it("claims and deduplicates a delivered monthly report", () => {
    expect(
      database.claimMonthlyReportDelivery(
        "2026-08-01",
        "2026-08-31",
        "/data/monthly.png",
      ),
    ).toMatchObject({
      monthStartDate: "2026-08-01",
      monthEndDate: "2026-08-31",
      deliveryStatus: "sending",
    });
    expect(
      database.claimMonthlyReportDelivery(
        "2026-08-01",
        "2026-08-31",
        "/data/monthly.png",
      ),
    ).toBeUndefined();

    database.markMonthlyReportDelivered("2026-08-01", 93);
    expect(database.getMonthlyReportDelivery("2026-08-01")).toMatchObject({
      deliveryStatus: "delivered",
      deliveryAttempts: 1,
      telegramMessageId: 93,
    });
  });

  it("stores every app metric snapshot and refreshes provisional data", () => {
    const apps = [
      {
        appAppleId: 123456789,
        name: "Available",
        bundleId: "com.example.available",
        firstReleaseDate: "2026-08-01",
        impressions: 100,
        downloads: 10,
        proceedsUsd: 2.5,
        impressionsAvailability: "available" as const,
        downloadsAvailability: "available" as const,
        proceedsAvailability: "available" as const,
      },
      {
        appAppleId: 987654321,
        name: "Pending",
        bundleId: "com.example.pending",
        impressionsAvailability: "pending" as const,
        downloadsAvailability: "pending" as const,
        proceedsAvailability: "pending" as const,
      },
    ];
    database.storePortfolioMetrics(
      "daily",
      "2026-08-25",
      "2026-08-25",
      apps,
      1_000,
    );
    expect(database.getPortfolioMetrics("daily", "2026-08-25")).toEqual([
      expect.objectContaining({
        name: "Available",
        firstReleaseDate: "2026-08-01",
        impressions: 100,
        collectedAt: 1_000,
      }),
      expect.objectContaining({
        name: "Pending",
        impressions: undefined,
        collectedAt: 1_000,
      }),
    ]);

    database.storePortfolioMetrics(
      "daily",
      "2026-08-25",
      "2026-08-25",
      [{ ...apps[0], impressions: 120 }],
      2_000,
    );
    expect(
      database
        .getPortfolioMetrics("daily", "2026-08-25")
        .find((item) => item.appAppleId === 123456789),
    ).toMatchObject({ impressions: 120, collectedAt: 2_000 });

    database.storePortfolioMetrics(
      "daily",
      "2026-08-25",
      "2026-08-25",
      [
        {
          ...apps[0],
          firstReleaseDate: undefined,
          impressions: undefined,
          downloads: undefined,
          proceedsUsd: undefined,
          impressionsAvailability: "pending",
          downloadsAvailability: "pending",
          proceedsAvailability: "pending",
        },
      ],
      3_000,
    );
    expect(
      database
        .getPortfolioMetrics("daily", "2026-08-25")
        .find((item) => item.appAppleId === 123456789),
    ).toMatchObject({
      firstReleaseDate: "2026-08-01",
      impressions: 120,
      downloads: 10,
      proceedsUsd: 2.5,
      impressionsAvailability: "available",
      downloadsAvailability: "available",
      proceedsAvailability: "available",
      collectedAt: 3_000,
    });
  });

  it("stores review batches and does not alert for the initial baseline", () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    const oldReview = {
      id: "review-old",
      rating: 5,
      title: "Great",
      body: "Works well",
      reviewerNickname: "Customer",
      territory: "USA",
      createdDate: "2026-07-30T08:00:00Z",
      messageHtml: "<b>Old review</b>",
    };
    expect(database.storeCustomerReviewBatch(app.id, [oldReview])).toEqual({
      baselineCreated: true,
      stored: 1,
      queued: 0,
    });

    expect(
      database.storeCustomerReviewBatch(app.id, [
        oldReview,
        {
          ...oldReview,
          id: "review-new",
          messageHtml: "<b>New review</b>",
        },
      ]),
    ).toEqual({
      baselineCreated: false,
      stored: 1,
      queued: 1,
    });
    expect(database.getCustomerReview("review-new")).toMatchObject({
      appId: app.id,
      rating: 5,
    });
    expect(database.listCustomerReviews(1)).toEqual([
      expect.objectContaining({
        id: "review-new",
        appName: "Example",
        bundleId: "com.example.app",
        body: "Works well",
      }),
    ]);
  });
});
