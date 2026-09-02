export interface RegisteredApp {
  id: number;
  name: string;
  bundleId: string;
  appAppleId: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PaymentEvent {
  notificationUuid: string;
  notificationType: string;
  subtype?: string;
  environment: string;
  signedDate: number;
  transactionId?: string;
  originalTransactionId?: string;
  webOrderLineItemId?: string;
  productId?: string;
  productType?: string;
  transactionReason?: string;
  inAppOwnershipType?: string;
  offerType?: number;
  offerIdentifier?: string;
  offerDiscountType?: string;
  offerPeriod?: string;
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  price?: number;
  currency?: string;
  renewalPrice?: number;
  renewalCurrency?: string;
  storefront?: string;
  autoRenewProductId?: string;
  autoRenewStatus?: number;
  renewalDate?: number;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  payload: Record<string, unknown>;
}

export type DeliveryStatus =
  | "pending"
  | "sending"
  | "retry"
  | "delivered"
  | "suppressed";

export interface StoredNotification {
  id: number;
  notificationUuid: string;
  appId?: number;
  appName?: string;
  notificationType: string;
  subtype?: string;
  environment: string;
  signedDate: number;
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  messageHtml: string;
  payloadJson: string;
  deliveryStatus: DeliveryStatus;
  deliveryAttempts: number;
  nextAttemptAt: number;
  lastError?: string;
  telegramMessageId?: number;
  receivedAt: number;
  deliveredAt?: number;
  suppressedAt?: number;
}

export interface NewNotification {
  appId?: number;
  event: PaymentEvent;
  messageHtml: string;
}

export interface StoredTelegramOutboxMessage {
  id: number;
  deduplicationKey: string;
  category: string;
  messageHtml: string;
  deliveryStatus: DeliveryStatus;
  deliveryAttempts: number;
  nextAttemptAt: number;
  lastError?: string;
  telegramMessageId?: number;
  createdAt: number;
  deliveredAt?: number;
  suppressedAt?: number;
}

export interface CustomerReview {
  id: string;
  rating: number;
  title: string;
  body: string;
  reviewerNickname: string;
  territory: string;
  createdDate: string;
}

export interface CustomerReviewWithMessage extends CustomerReview {
  messageHtml: string;
}

export interface StoredCustomerReview extends CustomerReview {
  appId: number;
  firstSeenAt: number;
}

export interface StoredCustomerReviewWithApp extends StoredCustomerReview {
  appName: string;
  bundleId: string;
}

export interface CustomerReviewBatchResult {
  baselineCreated: boolean;
  stored: number;
  queued: number;
}

export interface ExchangeRate {
  currencyCode: string;
  unitsPerUsd: number;
  sourceUpdatedAt: number;
  nextUpdateAt: number;
  fetchedAt: number;
  provider: string;
}

export type DailyMetricAvailability = "available" | "pending";

export interface DailyAppMetrics {
  appAppleId: number;
  name: string;
  bundleId: string;
  iconUrl?: string;
  impressions?: number;
  downloads?: number;
  proceedsUsd?: number;
  impressionsAvailability: DailyMetricAvailability;
  downloadsAvailability: DailyMetricAvailability;
  proceedsAvailability: DailyMetricAvailability;
  impressionsChangePercent?: number;
  downloadsChangePercent?: number;
  proceedsChangePercent?: number;
}

export type PortfolioReportKind = "daily" | "weekly";

export interface StoredPortfolioMetricSnapshot extends DailyAppMetrics {
  reportKind: PortfolioReportKind;
  periodStartDate: string;
  periodEndDate: string;
  collectedAt: number;
}

export interface DailyPortfolioReport {
  reportDate: string;
  generatedAt: string;
  timeZone: string;
  apps: DailyAppMetrics[];
  isSample?: boolean;
}

export interface WeeklyPortfolioReport {
  weekStartDate: string;
  weekEndDate: string;
  generatedAt: string;
  timeZone: string;
  apps: DailyAppMetrics[];
  isSample?: boolean;
}

export interface StoredDailyReportDelivery {
  reportDate: string;
  deliveryStatus: "pending" | "sending" | "retry" | "delivered";
  deliveryAttempts: number;
  nextAttemptAt: number;
  imagePath: string;
  lastError?: string;
  telegramMessageId?: number;
  createdAt: number;
  deliveredAt?: number;
}

export interface StoredWeeklyReportDelivery {
  weekStartDate: string;
  weekEndDate: string;
  deliveryStatus: "pending" | "sending" | "retry" | "delivered";
  deliveryAttempts: number;
  nextAttemptAt: number;
  imagePath: string;
  lastError?: string;
  telegramMessageId?: number;
  createdAt: number;
  deliveredAt?: number;
}
