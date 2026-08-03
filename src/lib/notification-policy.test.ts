import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTelegramNotificationPolicy,
  shouldSendOutboxNotification,
  shouldSendPaymentNotification,
} from "./notification-policy";

const managedKeys = [
  "TELEGRAM_PAYMENT_NOTIFICATION_TYPES",
  "TELEGRAM_PAYMENT_ENVIRONMENTS",
  "TELEGRAM_OUTBOX_CATEGORIES",
] as const;
const originalValues = new Map(
  managedKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of managedKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of managedKeys) {
    const original = originalValues.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("Telegram notification policy", () => {
  it("allows every verified event when no allowlists are configured", () => {
    expect(
      shouldSendPaymentNotification({
        notificationType: "DID_FAIL_TO_RENEW",
        environment: "Sandbox",
      }),
    ).toBe(true);
    expect(shouldSendOutboxNotification("app_registry")).toBe(true);
  });

  it("allows only successful production subscriptions and reviews", () => {
    process.env.TELEGRAM_PAYMENT_NOTIFICATION_TYPES = "SUBSCRIBED,DID_RENEW";
    process.env.TELEGRAM_PAYMENT_ENVIRONMENTS = "Production";
    process.env.TELEGRAM_OUTBOX_CATEGORIES = "app_review";

    expect(
      shouldSendPaymentNotification({
        notificationType: "SUBSCRIBED",
        environment: "Production",
      }),
    ).toBe(true);
    expect(
      shouldSendPaymentNotification({
        notificationType: "DID_RENEW",
        environment: "Production",
      }),
    ).toBe(true);
    expect(
      shouldSendPaymentNotification({
        notificationType: "DID_RENEW",
        environment: "Sandbox",
      }),
    ).toBe(false);
    expect(
      shouldSendPaymentNotification({
        notificationType: "DID_FAIL_TO_RENEW",
        environment: "Production",
      }),
    ).toBe(false);
    expect(shouldSendOutboxNotification("app_review")).toBe(true);
    expect(shouldSendOutboxNotification("app_registry")).toBe(false);
  });

  it("rejects malformed allowlists instead of silently widening them", () => {
    process.env.TELEGRAM_PAYMENT_NOTIFICATION_TYPES = "DID_RENEW,refund";
    expect(() => getTelegramNotificationPolicy()).toThrow(
      "Telegram notification policy is invalid",
    );
  });
});
