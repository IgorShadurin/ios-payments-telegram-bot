import { describe, expect, it } from "vitest";
import { escapeTelegramHtml, formatTelegramMessage } from "./message";
import type { PaymentEvent, RegisteredApp } from "./types";

const app: RegisteredApp = {
  id: 1,
  name: "Yum & Cut",
  bundleId: "com.example.yumcut",
  appAppleId: 123456789,
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

function makeEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    notificationUuid: "dc4f56bb-a7fa-4eb3-8d7d-fd1ab66e7cdf",
    notificationType: "DID_RENEW",
    environment: "Production",
    signedDate: 1_750_000_000_000,
    productId: "premium.monthly",
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
    expect(message).toContain("Subscription renewed");
    expect(message).toContain("$4.99");
    expect(message).toContain("premium.monthly");
    expect(message).toContain("Yum &amp; Cut");
  });

  it("uses a strong title for initial subscriptions and refunds", () => {
    expect(
      formatTelegramMessage(
        app,
        makeEvent({ notificationType: "SUBSCRIBED", subtype: "INITIAL_BUY" }),
      ),
    ).toContain("New subscription");
    expect(
      formatTelegramMessage(app, makeEvent({ notificationType: "REFUND" })),
    ).toContain("Refund");
  });

  it("escapes Telegram HTML control characters", () => {
    expect(escapeTelegramHtml("<hello> & goodbye")).toBe(
      "&lt;hello&gt; &amp; goodbye",
    );
  });
});
