import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";
import { deliverDueNotifications } from "./delivery";
import type { PaymentEvent } from "./types";

let directory: string;
let database: AppDatabase;
const originalPolicy = {
  types: process.env.TELEGRAM_PAYMENT_NOTIFICATION_TYPES,
  environments: process.env.TELEGRAM_PAYMENT_ENVIRONMENTS,
  categories: process.env.TELEGRAM_OUTBOX_CATEGORIES,
};

function event(
  notificationUuid: string,
  notificationType: string,
  environment: string,
): PaymentEvent {
  return {
    notificationUuid,
    notificationType,
    environment,
    signedDate: 1_750_000_000_000,
    payload: { verified: true },
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ios-delivery-policy-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
  process.env.TELEGRAM_PAYMENT_NOTIFICATION_TYPES = "SUBSCRIBED,DID_RENEW";
  process.env.TELEGRAM_PAYMENT_ENVIRONMENTS = "Production";
  process.env.TELEGRAM_OUTBOX_CATEGORIES = "app_review,app_registry";
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
  const values = [
    ["TELEGRAM_PAYMENT_NOTIFICATION_TYPES", originalPolicy.types],
    ["TELEGRAM_PAYMENT_ENVIRONMENTS", originalPolicy.environments],
    ["TELEGRAM_OUTBOX_CATEGORIES", originalPolicy.categories],
  ] as const;
  for (const [key, value] of values) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("filtered Telegram delivery", () => {
  it("stores queued sandbox and failed messages as suppressed", async () => {
    const app = database.addApp("Example", "com.example.app", 123456789);
    const sandbox = database.insertNotification({
      appId: app.id,
      event: event("sandbox-event", "DID_RENEW", "Sandbox"),
      messageHtml: "sandbox",
    }).notification;
    const failed = database.insertNotification({
      appId: app.id,
      event: event("failed-event", "DID_FAIL_TO_RENEW", "Production"),
      messageHtml: "failed",
    }).notification;
    const other = database.enqueueTelegramMessage(
      "other-event",
      "other_event",
      "other",
    ).message;

    await expect(deliverDueNotifications(database, 10)).resolves.toEqual({
      claimed: 3,
      delivered: 0,
      suppressed: 3,
      failed: 0,
    });
    expect(database.getNotificationById(sandbox.id)).toMatchObject({
      deliveryStatus: "suppressed",
      deliveryAttempts: 0,
      telegramMessageId: undefined,
      suppressedAt: expect.any(Number),
    });
    expect(database.getNotificationById(failed.id)).toMatchObject({
      deliveryStatus: "suppressed",
      deliveryAttempts: 0,
      telegramMessageId: undefined,
      suppressedAt: expect.any(Number),
    });
    expect(database.getTelegramOutboxMessageById(other.id)).toMatchObject({
      deliveryStatus: "suppressed",
      deliveryAttempts: 0,
      telegramMessageId: undefined,
      suppressedAt: expect.any(Number),
    });
    expect(database.pendingCount()).toBe(0);
    expect(database.pendingTelegramOutboxCount()).toBe(0);
  });
});
