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

export function appleOnlineChecksEnabled(): boolean {
  return (
    process.env.APPLE_ENABLE_ONLINE_CHECKS?.trim().toLowerCase() !== "false"
  );
}
