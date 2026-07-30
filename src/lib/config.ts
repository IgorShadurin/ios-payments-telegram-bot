import path from "node:path";
import { z } from "zod";

const optionalPositiveInteger = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().positive().safe())
  .optional();

export function getDatabasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  return configured || path.join(process.cwd(), "data", "ios-payments.sqlite");
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  messageThreadId?: number;
}

export interface TelegramWebhookConfig {
  secretToken: string;
  allowedUserIds: ReadonlySet<string>;
}

export function getTelegramConfig(): TelegramConfig {
  const schema = z.object({
    TELEGRAM_BOT_TOKEN: z
      .string()
      .min(20)
      .max(200)
      .regex(/^\d+:[A-Za-z0-9_-]+$/),
    TELEGRAM_CHAT_ID: z
      .string()
      .max(24)
      .regex(/^-?\d+$/),
    TELEGRAM_MESSAGE_THREAD_ID: optionalPositiveInteger,
  });

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Telegram configuration is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  return {
    botToken: parsed.data.TELEGRAM_BOT_TOKEN,
    chatId: parsed.data.TELEGRAM_CHAT_ID,
    messageThreadId: parsed.data.TELEGRAM_MESSAGE_THREAD_ID,
  };
}

export function getTelegramWebhookConfig(): TelegramWebhookConfig {
  const schema = z.object({
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .min(32)
      .max(256)
      .regex(/^[A-Za-z0-9_-]+$/),
    TELEGRAM_ALLOWED_USER_IDS: z
      .string()
      .min(1)
      .max(1_000)
      .transform((value, context) => {
        const ids = value
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        if (
          ids.length === 0 ||
          ids.some(
            (id) =>
              !/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id)),
          ) ||
          new Set(ids).size !== ids.length
        ) {
          context.addIssue({
            code: "custom",
            message:
              "Expected unique, comma-separated positive Telegram user IDs",
          });
          return z.NEVER;
        }
        return ids;
      }),
  });
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Telegram webhook configuration is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  return {
    secretToken: parsed.data.TELEGRAM_WEBHOOK_SECRET,
    allowedUserIds: new Set(parsed.data.TELEGRAM_ALLOWED_USER_IDS),
  };
}

export function appleOnlineChecksEnabled(): boolean {
  return (
    process.env.APPLE_ENABLE_ONLINE_CHECKS?.trim().toLowerCase() !== "false"
  );
}
