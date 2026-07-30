import { describe, expect, it } from "vitest";
import { escapeTelegramHtml, formatTelegramMessage } from "./message";
import type { ExchangeRate, PaymentEvent, RegisteredApp } from "./types";

const app: RegisteredApp = {
  id: 1,
  name: "Yum & Cut",
  bundleId: "com.example.yumcut",
  appAppleId: 123456789,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

const jpyRate: ExchangeRate = {
  currencyCode: "JPY",
  unitsPerUsd: 156.25,
  sourceUpdatedAt: 1_750_000_000_000,
  nextUpdateAt: 1_750_086_400_000,
  fetchedAt: 1_750_000_100_000,
  provider: "ExchangeRate-API",
};

function makeEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    notificationUuid: "dc4f56bb-a7fa-4eb3-8d7d-fd1ab66e7cdf",
    notificationType: "DID_RENEW",
    environment: "Production",
    signedDate: 1_750_000_000_000,
    productId: "premium.monthly",
    productType: "Auto-Renewable Subscription",
    transactionReason: "RENEWAL",
    price: 4_990,
    currency: "USD",
    transactionId: "2000000123456789",
    payload: {},
    ...overrides,
  };
}

describe("Telegram message formatting", () => {
  it("formats renewal details and Apple's milliunit price", () => {
    const message = formatTelegramMessage(app, makeEvent());
    expect(message).toContain("✅ Subscription renewed");
    expect(message).not.toContain("PRODUCTION");
    expect(message).not.toContain("<b>Environment:</b>");
    expect(message).toContain("Renewal of an existing subscription");
    expect(message).toContain("Auto-renewable subscription");
    expect(message).toContain("$4.99");
    expect(message).toContain("premium.monthly");
    expect(message).toContain("Yum &amp; Cut");
  });

  it("puts the USD conversion before the original non-USD price", () => {
    const message = formatTelegramMessage(
      app,
      makeEvent({
        notificationType: "ONE_TIME_CHARGE",
        price: 800_000,
        currency: "JPY",
      }),
      jpyRate,
    );

    expect(message).toContain("<b>Amount:</b> $5.12 (¥800)");
    expect(message).toContain(
      '<b>FX rate:</b> <a href="https://www.exchangerate-api.com">ExchangeRate-API</a>',
    );
  });

  it("makes sandbox transactions unmistakably test-only", () => {
    const message = formatTelegramMessage(
      app,
      makeEvent({ environment: "Sandbox" }),
    );
    expect(message).toContain("🧪 [SANDBOX] Subscription renewed");
    expect(message).not.toContain("✅ [SANDBOX]");
    expect(message).toContain("Sandbox (test only; no real charge)");
    expect(message).toContain("$4.99 (test price)");
  });

  it("distinguishes one-time purchases from subscriptions", () => {
    const message = formatTelegramMessage(
      app,
      makeEvent({
        notificationType: "ONE_TIME_CHARGE",
        productType: "Non-Consumable",
        transactionReason: "PURCHASE",
      }),
    );
    expect(message).toContain("New one-time purchase");
    expect(message).toContain("One-time purchase (non-consumable)");
    expect(message).not.toContain("Renewal of an existing subscription");
  });

  it("uses a strong title for initial subscriptions and refunds", () => {
    const subscription = formatTelegramMessage(
      app,
      makeEvent({
        notificationType: "SUBSCRIBED",
        subtype: "INITIAL_BUY",
        transactionReason: "PURCHASE",
      }),
    );
    expect(subscription).toContain("New subscription");
    expect(subscription).toContain("First subscription purchase");

    const refund = formatTelegramMessage(
      app,
      makeEvent({ notificationType: "REFUND" }),
    );
    expect(refund).toContain("Refund");
    expect(refund).toContain("Refund issued");
  });

  it("escapes Telegram HTML control characters", () => {
    expect(escapeTelegramHtml("<hello> & goodbye")).toBe(
      "&lt;hello&gt; &amp; goodbye",
    );
  });
});
