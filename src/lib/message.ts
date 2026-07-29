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
  const details = [
    line("App", `${app.name} (${app.bundleId})`),
    line(
      "Event",
      event.subtype
        ? `${event.notificationType} / ${event.subtype}`
        : event.notificationType,
    ),
    line("Environment", event.environment),
    line("Product", event.productId),
    event.price !== undefined
      ? line("Amount", formatPrice(event.price, event.currency))
      : undefined,
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
    `<b>${escapeTelegramHtml(eventTitle(event.notificationType, event.subtype))}</b>`,
    ...details,
  ].join("\n");
}
