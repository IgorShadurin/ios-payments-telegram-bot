import type { PaymentEvent, RegisteredApp } from "./types";

export function escapeTelegramHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function eventTitle(type: string, subtype?: string): string {
  const key = `${type}:${subtype ?? ""}`;
  const exact: Record<string, string> = {
    "SUBSCRIBED:INITIAL_BUY": "🟢 New subscription",
    "SUBSCRIBED:RESUBSCRIBE": "🔁 Subscription restarted",
    "DID_RENEW:BILLING_RECOVERY": "✅ Subscription recovered",
    "DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_ENABLED": "🔄 Auto-renew enabled",
    "DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED": "⏸ Auto-renew disabled",
  };
  if (exact[key]) {
    return exact[key];
  }

  const titles: Record<string, string> = {
    SUBSCRIBED: "🟢 Subscription started",
    ONE_TIME_CHARGE: "💳 Purchase",
    DID_RENEW: "✅ Subscription renewed",
    DID_FAIL_TO_RENEW: "⚠️ Renewal failed",
    EXPIRED: "⛔ Subscription expired",
    GRACE_PERIOD_EXPIRED: "⌛ Grace period expired",
    REFUND: "↩️ Refund",
    REFUND_REVERSED: "♻️ Refund reversed",
    REFUND_DECLINED: "🛡 Refund declined",
    REVOKE: "🛑 Purchase revoked",
    CONSUMPTION_REQUEST: "ℹ️ Consumption request",
    OFFER_REDEEMED: "🎟 Offer redeemed",
    DID_CHANGE_RENEWAL_PREF: "🔀 Subscription plan changed",
    DID_CHANGE_RENEWAL_STATUS: "🔄 Renewal status changed",
    PRICE_INCREASE: "💰 Price increase status",
    PRICE_CHANGE: "💰 Price changed",
    RENEWAL_EXTENDED: "📅 Renewal extended",
    RENEWAL_EXTENSION: "📅 Renewal extension result",
    TEST: "🧪 Apple test notification",
    EXTERNAL_PURCHASE_TOKEN: "🔗 External purchase token",
    RESCIND_CONSENT: "🛑 Consent rescinded",
    METADATA_UPDATE: "📝 Purchase metadata updated",
    MIGRATION: "🚚 Purchase migrated",
  };
  return titles[type] ?? `📱 ${type.replaceAll("_", " ").toLowerCase()}`;
}

function formatDate(timestamp: number): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp))} UTC`;
}

function formatPrice(price: number, currency?: string): string {
  const amount = price / 1000;
  if (!currency) {
    return amount.toFixed(3);
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 3,
    }).format(amount);
  } catch {
    return `${amount.toFixed(3)} ${currency}`;
  }
}

function environmentLabel(environment: string): {
  titleTag?: string;
  detail: string;
  isTest: boolean;
} {
  if (environment.toLowerCase() === "sandbox") {
    return {
      titleTag: "SANDBOX",
      detail: "Sandbox (test only; no real charge)",
      isTest: true,
    };
  }
  if (environment.toLowerCase() === "production") {
    return {
      titleTag: "PRODUCTION",
      detail: "Production (live App Store data)",
      isTest: false,
    };
  }
  return {
    detail: environment,
    isTest: false,
  };
}

function titleWithEnvironment(title: string, titleTag?: string): string {
  if (!titleTag) {
    return title;
  }
  const separator = title.indexOf(" ");
  if (separator === -1) {
    return `[${titleTag}] ${title}`;
  }
  return `${title.slice(0, separator)} [${titleTag}]${title.slice(separator)}`;
}

function paymentTypeLabel(event: PaymentEvent): string | undefined {
  const productTypes: Record<string, string> = {
    "Auto-Renewable Subscription": "Auto-renewable subscription",
    "Non-Renewing Subscription": "Non-renewing subscription",
    "Non-Consumable": "One-time purchase (non-consumable)",
    Consumable: "One-time purchase (consumable)",
  };
  if (event.productType) {
    return productTypes[event.productType] ?? event.productType;
  }
  if (
    event.notificationType === "SUBSCRIBED" ||
    event.notificationType === "DID_RENEW" ||
    event.expiresDate !== undefined ||
    event.autoRenewProductId !== undefined
  ) {
    return "Auto-renewable subscription";
  }
  if (event.notificationType === "ONE_TIME_CHARGE") {
    return "One-time in-app purchase";
  }
  return undefined;
}

function actionLabel(event: PaymentEvent): string | undefined {
  const key = `${event.notificationType}:${event.subtype ?? ""}`;
  const exact: Record<string, string> = {
    "SUBSCRIBED:INITIAL_BUY": "First subscription purchase",
    "SUBSCRIBED:RESUBSCRIBE": "Subscription restarted after expiry",
    "DID_RENEW:BILLING_RECOVERY": "Renewal after billing recovery",
  };
  if (exact[key]) {
    return exact[key];
  }

  const actions: Record<string, string> = {
    DID_RENEW: "Renewal of an existing subscription",
    ONE_TIME_CHARGE: "New one-time purchase",
    DID_FAIL_TO_RENEW: "Subscription renewal attempt failed",
    EXPIRED: "Subscription access expired",
    GRACE_PERIOD_EXPIRED: "Subscription grace period expired",
    REFUND: "Refund issued",
    REFUND_REVERSED: "Previously issued refund reversed",
    REFUND_DECLINED: "Refund request declined",
    REVOKE: "Purchase access revoked",
  };
  if (actions[event.notificationType]) {
    return actions[event.notificationType];
  }
  if (event.transactionReason === "RENEWAL") {
    return "Renewal of an existing subscription";
  }
  if (event.transactionReason === "PURCHASE") {
    return "Customer-initiated purchase";
  }
  return undefined;
}

function line(
  label: string,
  value: string | number | undefined,
): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return `<b>${label}:</b> ${escapeTelegramHtml(String(value))}`;
}

export function formatTelegramMessage(
  app: RegisteredApp,
  event: PaymentEvent,
): string {
  const environment = environmentLabel(event.environment);
  const details = [
    line("App", `${app.name} (${app.bundleId})`),
    line("Action", actionLabel(event)),
    line("Payment type", paymentTypeLabel(event)),
    line("Product", event.productId),
    event.price !== undefined
      ? line(
          "Amount",
          `${formatPrice(event.price, event.currency)}${
            environment.isTest ? " (test price)" : ""
          }`,
        )
      : undefined,
    line("Environment", environment.detail),
    line(
      "Event",
      event.subtype
        ? `${event.notificationType} / ${event.subtype}`
        : event.notificationType,
    ),
    line("Transaction", event.transactionId),
    line("Original transaction", event.originalTransactionId),
    event.purchaseDate
      ? line("Purchased", formatDate(event.purchaseDate))
      : undefined,
    event.expiresDate
      ? line("Expires", formatDate(event.expiresDate))
      : undefined,
    event.renewalDate
      ? line("Next renewal", formatDate(event.renewalDate))
      : undefined,
    event.revocationDate
      ? line("Revoked", formatDate(event.revocationDate))
      : undefined,
  ].filter((value): value is string => Boolean(value));

  return [
    `<b>${escapeTelegramHtml(
      titleWithEnvironment(
        eventTitle(event.notificationType, event.subtype),
        environment.titleTag,
      ),
    )}</b>`,
    ...details,
  ].join("\n");
}
