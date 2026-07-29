import {
  Environment,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { APPLE_ROOT_CERTIFICATES } from "./apple-root-certificates";
import { appleOnlineChecksEnabled } from "./config";
import type { AppDatabase } from "./database";
import type { PaymentEvent, RegisteredApp } from "./types";

interface RoutingHint {
  bundleId: string;
  environment: Environment.SANDBOX | Environment.PRODUCTION;
}

interface VerifiedAppleEvent {
  app: RegisteredApp;
  event: PaymentEvent;
}

export class AppleNotificationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MALFORMED_JWS"
      | "UNREGISTERED_APP"
      | "UNSUPPORTED_ENVIRONMENT"
      | "VERIFICATION_FAILED"
      | "INVALID_PAYLOAD",
  ) {
    super(message);
    this.name = "AppleNotificationError";
  }
}

function getRoutingHint(payload: Record<string, unknown>): RoutingHint {
  const source =
    (payload.data as Record<string, unknown> | undefined) ??
    (payload.summary as Record<string, unknown> | undefined) ??
    (payload.appData as Record<string, unknown> | undefined) ??
    (payload.externalPurchaseToken as Record<string, unknown> | undefined);

  const bundleId = source?.bundleId;
  let environment = source?.environment;

  if (!environment && typeof source?.externalPurchaseId === "string") {
    environment = source.externalPurchaseId.startsWith("SANDBOX")
      ? Environment.SANDBOX
      : Environment.PRODUCTION;
  }

  if (typeof bundleId !== "string" || !bundleId) {
    throw new AppleNotificationError(
      "The signed payload does not contain an app bundle identifier",
      "INVALID_PAYLOAD",
    );
  }
  if (
    environment !== Environment.SANDBOX &&
    environment !== Environment.PRODUCTION
  ) {
    throw new AppleNotificationError(
      "Only App Store Sandbox and Production notifications are supported",
      "UNSUPPORTED_ENVIRONMENT",
    );
  }

  return { bundleId, environment };
}

export function decodeUntrustedRoutingHint(signedPayload: string): RoutingHint {
  const parts = signedPayload.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new AppleNotificationError(
      "signedPayload is not a compact JWS",
      "MALFORMED_JWS",
    );
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("JWS payload is not an object");
    }
    return getRoutingHint(decoded as Record<string, unknown>);
  } catch (error) {
    if (error instanceof AppleNotificationError) {
      throw error;
    }
    throw new AppleNotificationError(
      "signedPayload cannot be decoded",
      "MALFORMED_JWS",
    );
  }
}

const verifierCache = new Map<string, SignedDataVerifier>();

function getVerifier(
  app: RegisteredApp,
  environment: RoutingHint["environment"],
) {
  const key = [
    app.bundleId,
    app.appAppleId,
    environment,
    appleOnlineChecksEnabled(),
  ].join(":");
  let verifier = verifierCache.get(key);
  if (!verifier) {
    verifier = new SignedDataVerifier(
      APPLE_ROOT_CERTIFICATES,
      appleOnlineChecksEnabled(),
      environment,
      app.bundleId,
      environment === Environment.PRODUCTION ? app.appAppleId : undefined,
    );
    verifierCache.set(key, verifier);
  }
  return verifier;
}

function withoutSensitiveFields<T extends Record<string, unknown>>(
  value: T,
): T {
  const blocked = new Set([
    "appAccountToken",
    "externalPurchaseId",
    "signedAppTransaction",
    "signedRenewalInfo",
    "signedTransactionInfo",
    "tokenCreationDate",
  ]);

  function clean(input: unknown): unknown {
    if (Array.isArray(input)) {
      return input.map(clean);
    }
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([key]) => !blocked.has(key))
          .map(([key, child]) => [key, clean(child)]),
      );
    }
    return input;
  }

  return clean(value) as T;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new AppleNotificationError(
      `Verified Apple notification is missing ${field}`,
      "INVALID_PAYLOAD",
    );
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AppleNotificationError(
      `Verified Apple notification is missing ${field}`,
      "INVALID_PAYLOAD",
    );
  }
  return value;
}

function makePaymentEvent(
  notification: ResponseBodyV2DecodedPayload,
  environment: string,
  transaction?: JWSTransactionDecodedPayload,
  renewal?: JWSRenewalInfoDecodedPayload,
): PaymentEvent {
  const notificationType = requireString(
    notification.notificationType,
    "notificationType",
  );
  const notificationUuid = requireString(
    notification.notificationUUID,
    "notificationUUID",
  );
  const signedDate = requireNumber(notification.signedDate, "signedDate");

  return {
    notificationUuid,
    notificationType,
    subtype:
      typeof notification.subtype === "string"
        ? notification.subtype
        : undefined,
    environment,
    signedDate,
    transactionId: transaction?.transactionId,
    originalTransactionId:
      transaction?.originalTransactionId ?? renewal?.originalTransactionId,
    webOrderLineItemId: transaction?.webOrderLineItemId,
    productId: transaction?.productId ?? renewal?.productId,
    productType: transaction?.type,
    transactionReason: transaction?.transactionReason,
    purchaseDate: transaction?.purchaseDate,
    originalPurchaseDate: transaction?.originalPurchaseDate,
    expiresDate: transaction?.expiresDate,
    revocationDate: transaction?.revocationDate,
    revocationReason: transaction?.revocationReason,
    price: transaction?.price ?? renewal?.renewalPrice,
    currency: transaction?.currency ?? renewal?.currency,
    storefront: transaction?.storefront,
    autoRenewProductId: renewal?.autoRenewProductId,
    autoRenewStatus: renewal?.autoRenewStatus,
    renewalDate: renewal?.renewalDate,
    expirationIntent: renewal?.expirationIntent,
    gracePeriodExpiresDate: renewal?.gracePeriodExpiresDate,
    isInBillingRetryPeriod: renewal?.isInBillingRetryPeriod,
    payload: withoutSensitiveFields({
      notification,
      transaction,
      renewal,
    }),
  };
}

export async function verifyAppleNotification(
  signedPayload: string,
  database: AppDatabase,
): Promise<VerifiedAppleEvent> {
  const hint = decodeUntrustedRoutingHint(signedPayload);
  const app = database.getAppByBundleId(hint.bundleId);
  if (!app) {
    throw new AppleNotificationError(
      `No enabled app is registered for bundle ID ${hint.bundleId}`,
      "UNREGISTERED_APP",
    );
  }

  const verifier = getVerifier(app, hint.environment);
  let notification: ResponseBodyV2DecodedPayload;
  let transaction: JWSTransactionDecodedPayload | undefined;
  let renewal: JWSRenewalInfoDecodedPayload | undefined;

  try {
    notification = await verifier.verifyAndDecodeNotification(signedPayload);
    if (notification.data?.signedTransactionInfo) {
      transaction = await verifier.verifyAndDecodeTransaction(
        notification.data.signedTransactionInfo,
      );
    }
    if (notification.data?.signedRenewalInfo) {
      renewal = await verifier.verifyAndDecodeRenewalInfo(
        notification.data.signedRenewalInfo,
      );
    }
  } catch {
    throw new AppleNotificationError(
      "Apple signature or app identity verification failed",
      "VERIFICATION_FAILED",
    );
  }

  const environment =
    notification.data?.environment ??
    notification.summary?.environment ??
    notification.appData?.environment ??
    hint.environment;

  return {
    app,
    event: makePaymentEvent(notification, environment, transaction, renewal),
  };
}
