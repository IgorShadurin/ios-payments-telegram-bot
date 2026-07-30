import type { AppDatabase } from "./database";
import { sendTelegramMessage, TelegramDeliveryError } from "./telegram";
import type { StoredNotification, StoredTelegramOutboxMessage } from "./types";

function retryDelayMs(attempts: number): number {
  const scheduleMinutes = [1, 5, 15, 60, 360, 720, 1_440];
  const index = Math.min(attempts, scheduleMinutes.length - 1);
  return scheduleMinutes[index] * 60 * 1000;
}

async function deliverClaimed(
  database: AppDatabase,
  notification: StoredNotification,
): Promise<boolean> {
  try {
    const messageId = await sendTelegramMessage(notification.messageHtml);
    database.markDelivered(notification.id, messageId);
    return true;
  } catch (error) {
    const retryAfterMs =
      error instanceof TelegramDeliveryError && error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : retryDelayMs(notification.deliveryAttempts);
    const message =
      error instanceof Error ? error.message : "Unknown Telegram error";
    database.markForRetry(notification.id, message, Date.now() + retryAfterMs);
    return false;
  }
}

async function deliverClaimedOutboxMessage(
  database: AppDatabase,
  message: StoredTelegramOutboxMessage,
): Promise<boolean> {
  try {
    const messageId = await sendTelegramMessage(message.messageHtml);
    database.markTelegramOutboxDelivered(message.id, messageId);
    return true;
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
    return false;
  }
}

export async function deliverNotificationNow(
  database: AppDatabase,
  id: number,
): Promise<boolean> {
  const claimed = database.claimNotification(id);
  if (!claimed) {
    return false;
  }
  return deliverClaimed(database, claimed);
}

export async function deliverTelegramOutboxMessageNow(
  database: AppDatabase,
  id: number,
): Promise<boolean> {
  const claimed = database.claimTelegramOutboxMessage(id);
  if (!claimed) {
    return false;
  }
  return deliverClaimedOutboxMessage(database, claimed);
}

export async function deliverDueNotifications(
  database: AppDatabase,
  limit: number,
): Promise<{ claimed: number; delivered: number; failed: number }> {
  const outboxMessages = database.claimDueTelegramOutboxMessages(limit);
  const notifications = database.claimDueNotifications(
    Math.max(0, limit - outboxMessages.length),
  );
  let delivered = 0;
  for (const message of outboxMessages) {
    if (await deliverClaimedOutboxMessage(database, message)) {
      delivered += 1;
    }
  }
  for (const notification of notifications) {
    if (await deliverClaimed(database, notification)) {
      delivered += 1;
    }
  }
  const claimed = outboxMessages.length + notifications.length;
  return {
    claimed,
    delivered,
    failed: claimed - delivered,
  };
}
