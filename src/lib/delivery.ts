import type { AppDatabase } from "./database";
import {
  shouldSendOutboxNotification,
  shouldSendPaymentNotification,
} from "./notification-policy";
import { sendTelegramMessage, TelegramDeliveryError } from "./telegram";
import type { StoredNotification, StoredTelegramOutboxMessage } from "./types";

export type TelegramDeliveryOutcome = "delivered" | "suppressed" | "failed";

function retryDelayMs(attempts: number): number {
  const scheduleMinutes = [1, 5, 15, 60, 360, 720, 1_440];
  const index = Math.min(attempts, scheduleMinutes.length - 1);
  return scheduleMinutes[index] * 60 * 1000;
}

async function deliverClaimed(
  database: AppDatabase,
  notification: StoredNotification,
): Promise<TelegramDeliveryOutcome> {
  if (!shouldSendPaymentNotification(notification)) {
    database.markNotificationSuppressed(notification.id);
    return "suppressed";
  }
  try {
    const messageId = await sendTelegramMessage(notification.messageHtml);
    database.markDelivered(notification.id, messageId);
    return "delivered";
  } catch (error) {
    const retryAfterMs =
      error instanceof TelegramDeliveryError && error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : retryDelayMs(notification.deliveryAttempts);
    const message =
      error instanceof Error ? error.message : "Unknown Telegram error";
    database.markForRetry(notification.id, message, Date.now() + retryAfterMs);
    return "failed";
  }
}

async function deliverClaimedOutboxMessage(
  database: AppDatabase,
  message: StoredTelegramOutboxMessage,
): Promise<TelegramDeliveryOutcome> {
  if (!shouldSendOutboxNotification(message.category)) {
    database.markTelegramOutboxSuppressed(message.id);
    return "suppressed";
  }
  try {
    const messageId = await sendTelegramMessage(message.messageHtml);
    database.markTelegramOutboxDelivered(message.id, messageId);
    return "delivered";
  } catch (error) {
    const retryAfterMs =
      error instanceof TelegramDeliveryError && error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : retryDelayMs(message.deliveryAttempts);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown Telegram error";
    database.markTelegramOutboxForRetry(
      message.id,
      errorMessage,
      Date.now() + retryAfterMs,
    );
    return "failed";
  }
}

export async function deliverNotificationNow(
  database: AppDatabase,
  id: number,
): Promise<TelegramDeliveryOutcome | undefined> {
  const claimed = database.claimNotification(id);
  if (!claimed) {
    return undefined;
  }
  return deliverClaimed(database, claimed);
}

export async function deliverTelegramOutboxMessageNow(
  database: AppDatabase,
  id: number,
): Promise<TelegramDeliveryOutcome | undefined> {
  const claimed = database.claimTelegramOutboxMessage(id);
  if (!claimed) {
    return undefined;
  }
  return deliverClaimedOutboxMessage(database, claimed);
}

export async function deliverDueNotifications(
  database: AppDatabase,
  limit: number,
): Promise<{
  claimed: number;
  delivered: number;
  suppressed: number;
  failed: number;
}> {
  const outboxMessages = database.claimDueTelegramOutboxMessages(limit);
  const notifications = database.claimDueNotifications(
    Math.max(0, limit - outboxMessages.length),
  );
  let delivered = 0;
  let suppressed = 0;
  for (const message of outboxMessages) {
    const outcome = await deliverClaimedOutboxMessage(database, message);
    if (outcome === "delivered") {
      delivered += 1;
    } else if (outcome === "suppressed") {
      suppressed += 1;
    }
  }
  for (const notification of notifications) {
    const outcome = await deliverClaimed(database, notification);
    if (outcome === "delivered") {
      delivered += 1;
    } else if (outcome === "suppressed") {
      suppressed += 1;
    }
  }
  const claimed = outboxMessages.length + notifications.length;
  return {
    claimed,
    delivered,
    suppressed,
    failed: claimed - delivered - suppressed,
  };
}
