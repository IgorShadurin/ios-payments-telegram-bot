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

export interface AppStoreConnectConfig {
  keyType: "team" | "individual";
  issuerId?: string;
  keyId: string;
  privateKey: string;
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

function decodePrivateKeyBase64(
  value: string,
  variableName = "APP_STORE_CONNECT_PRIVATE_KEY_BASE64",
): string {
  if (
    value.length > 20_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error(
      `App Store Connect configuration is invalid: ${variableName}`,
    );
  }
  return Buffer.from(value, "base64").toString("utf8");
}

export function getAppStoreConnectConfig(): AppStoreConnectConfig {
  const schema = z.object({
    APP_STORE_CONNECT_KEY_TYPE: z.enum(["team", "individual"]).default("team"),
    APP_STORE_CONNECT_ISSUER_ID: z
      .string()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      )
      .optional(),
    APP_STORE_CONNECT_KEY_ID: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9]+$/),
    APP_STORE_CONNECT_PRIVATE_KEY: z.string().min(100).max(20_000).optional(),
    APP_STORE_CONNECT_PRIVATE_KEY_BASE64: z
      .string()
      .min(100)
      .max(20_000)
      .optional(),
  });
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `App Store Connect configuration is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  const rawKey = parsed.data.APP_STORE_CONNECT_PRIVATE_KEY;
  const base64Key = parsed.data.APP_STORE_CONNECT_PRIVATE_KEY_BASE64;
  if ((rawKey ? 1 : 0) + (base64Key ? 1 : 0) !== 1) {
    throw new Error(
      "App Store Connect configuration is invalid: set exactly one private-key variable",
    );
  }
  if (
    parsed.data.APP_STORE_CONNECT_KEY_TYPE === "team" &&
    !parsed.data.APP_STORE_CONNECT_ISSUER_ID
  ) {
    throw new Error(
      "App Store Connect configuration is invalid: team keys require APP_STORE_CONNECT_ISSUER_ID",
    );
  }

  return {
    keyType: parsed.data.APP_STORE_CONNECT_KEY_TYPE,
    issuerId: parsed.data.APP_STORE_CONNECT_ISSUER_ID,
    keyId: parsed.data.APP_STORE_CONNECT_KEY_ID,
    privateKey: rawKey ?? decodePrivateKeyBase64(base64Key ?? ""),
  };
}

export function getAppStoreAnalyticsConfig(): AppStoreConnectConfig {
  const configured = [
    process.env.APPLE_ANALYTICS_KEY_TYPE,
    process.env.APPLE_ANALYTICS_ISSUER_ID,
    process.env.APPLE_ANALYTICS_KEY_ID,
    process.env.APPLE_ANALYTICS_PRIVATE_KEY,
    process.env.APPLE_ANALYTICS_PRIVATE_KEY_BASE64,
  ].some((value) => value?.trim());
  if (!configured) {
    return getAppStoreConnectConfig();
  }

  const schema = z.object({
    APPLE_ANALYTICS_KEY_TYPE: z.enum(["team", "individual"]).default("team"),
    APPLE_ANALYTICS_ISSUER_ID: z
      .string()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      )
      .optional(),
    APPLE_ANALYTICS_KEY_ID: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9]+$/),
    APPLE_ANALYTICS_PRIVATE_KEY: z.string().min(100).max(20_000).optional(),
    APPLE_ANALYTICS_PRIVATE_KEY_BASE64: z
      .string()
      .min(100)
      .max(20_000)
      .optional(),
  });
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `App Store analytics configuration is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  const rawKey = parsed.data.APPLE_ANALYTICS_PRIVATE_KEY;
  const base64Key = parsed.data.APPLE_ANALYTICS_PRIVATE_KEY_BASE64;
  if ((rawKey ? 1 : 0) + (base64Key ? 1 : 0) !== 1) {
    throw new Error(
      "App Store analytics configuration is invalid: set exactly one private-key variable",
    );
  }
  if (
    parsed.data.APPLE_ANALYTICS_KEY_TYPE === "team" &&
    !parsed.data.APPLE_ANALYTICS_ISSUER_ID
  ) {
    throw new Error(
      "App Store analytics configuration is invalid: team keys require APPLE_ANALYTICS_ISSUER_ID",
    );
  }
  return {
    keyType: parsed.data.APPLE_ANALYTICS_KEY_TYPE,
    issuerId: parsed.data.APPLE_ANALYTICS_ISSUER_ID,
    keyId: parsed.data.APPLE_ANALYTICS_KEY_ID,
    privateKey:
      rawKey ??
      decodePrivateKeyBase64(
        base64Key ?? "",
        "APPLE_ANALYTICS_PRIVATE_KEY_BASE64",
      ),
  };
}
