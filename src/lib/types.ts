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
  purchaseDate?: number;
  originalPurchaseDate?: number;
  expiresDate?: number;
  revocationDate?: number;
  revocationReason?: number;
  price?: number;
  currency?: string;
  storefront?: string;
  autoRenewProductId?: string;
  autoRenewStatus?: number;
  renewalDate?: number;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  payload: Record<string, unknown>;
}

export type DeliveryStatus = "pending" | "sending" | "retry" | "delivered";

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

export interface CustomerReviewBatchResult {
  baselineCreated: boolean;
  stored: number;
  queued: number;
}
