import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getTelegramWebhookConfig } from "./config";

export const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative().safe(),
    message: z
      .object({
        message_id: z.number().int().nonnegative().safe(),
        from: z
          .object({
            id: z.number().int().positive().safe(),
            is_bot: z.boolean().optional(),
          })
          .passthrough()
          .optional(),
        chat: z
          .object({
            id: z.number().int().safe(),
            type: z.string(),
          })
          .passthrough(),
        text: z.string().max(4_096).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isTelegramWebhookAuthorized(request: Request): boolean {
  const supplied = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  const expected = getTelegramWebhookConfig().secretToken;
  return timingSafeEqual(digest(supplied), digest(expected));
}

export function isApprovedPrivateMessage(message: {
  from?: { id: number; is_bot?: boolean };
  chat: { id: number; type: string };
}): boolean {
  if (
    !message.from ||
    message.from.is_bot ||
    message.chat.type !== "private" ||
    message.chat.id !== message.from.id
  ) {
    return false;
  }
  return getTelegramWebhookConfig().allowedUserIds.has(String(message.from.id));
}
