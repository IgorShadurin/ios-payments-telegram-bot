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
  return parseAppStoreConnectConfig(process.env);
}

function parseAppStoreConnectConfig(
  environment: Record<string, string | undefined>,
): AppStoreConnectConfig {
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
  const parsed = schema.safeParse(environment);
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

export interface ReviewAccountConfig {
  id: string;
  appAppleIds: readonly number[];
  credentials: AppStoreConnectConfig;
}

export function getReviewAccountConfigs(): ReviewAccountConfig[] {
  const accounts: ReviewAccountConfig[] = [
    {
      id: "default",
      appAppleIds: [],
      credentials: getAppStoreConnectConfig(),
    },
  ];
  const raw = process.env.APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON;
  if (!raw?.trim()) return accounts;
  const variableName = "APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON";
  try {
    const entries = z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
            appAppleIds: z
              .array(z.number().int().positive().safe())
              .min(1)
              .max(500),
            keyType: z.enum(["team", "individual"]).default("team"),
            issuerId: z.string().optional(),
            keyId: z.string(),
            privateKeyBase64: z.string(),
          })
          .strict(),
      )
      .max(20)
      .parse(JSON.parse(raw));
    const ids = new Set(["default"]);
    const apps = new Set<number>();
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error("Duplicate account ID");
      ids.add(entry.id);
      for (const id of entry.appAppleIds) {
        if (apps.has(id)) throw new Error("Duplicate app assignment");
        apps.add(id);
      }
      accounts.push({
        id: entry.id,
        appAppleIds: entry.appAppleIds,
        credentials: parseAppStoreConnectConfig({
          APP_STORE_CONNECT_KEY_TYPE: entry.keyType,
          APP_STORE_CONNECT_ISSUER_ID: entry.issuerId,
          APP_STORE_CONNECT_KEY_ID: entry.keyId,
          APP_STORE_CONNECT_PRIVATE_KEY_BASE64: entry.privateKeyBase64,
        }),
      });
    }
  } catch {
    // Never include JSON parser/Zod details: they can contain key material.
    throw new Error(
      `App Store Connect configuration is invalid: ${variableName}`,
    );
  }
  return accounts;
}

export interface AnalyticsAccountConfig extends ReviewAccountConfig {
  setupCredentials?: AppStoreConnectConfig;
}

export function getAnalyticsAccountConfigs(): AnalyticsAccountConfig[] {
  const accounts: AnalyticsAccountConfig[] = [
    {
      id: "default",
      appAppleIds: [],
      credentials: getAppStoreAnalyticsConfig(),
    },
  ];
  const raw = process.env.APPLE_ANALYTICS_ACCOUNTS_JSON;
  if (!raw?.trim()) return accounts;
  const credentialSchema = z
    .object({
      keyType: z.enum(["team", "individual"]).default("team"),
      issuerId: z.string().optional(),
      keyId: z.string(),
      privateKeyBase64: z.string(),
    })
    .strict();
  const parseCredentials = (value: z.infer<typeof credentialSchema>) =>
    parseAppStoreConnectConfig({
      APP_STORE_CONNECT_KEY_TYPE: value.keyType,
      APP_STORE_CONNECT_ISSUER_ID: value.issuerId,
      APP_STORE_CONNECT_KEY_ID: value.keyId,
      APP_STORE_CONNECT_PRIVATE_KEY_BASE64: value.privateKeyBase64,
    });
  try {
    const entries = z
      .array(
        credentialSchema
          .extend({
            id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
            appAppleIds: z
              .array(z.number().int().positive().safe())
              .min(1)
              .max(500),
            setup: credentialSchema.optional(),
          })
          .strict(),
      )
      .max(20)
      .parse(JSON.parse(raw));
    const ids = new Set(["default"]);
    const apps = new Set<number>();
    for (const entry of entries) {
      if (ids.has(entry.id)) throw new Error("Duplicate account ID");
      ids.add(entry.id);
      for (const id of entry.appAppleIds) {
        if (apps.has(id)) throw new Error("Duplicate app assignment");
        apps.add(id);
      }
      const credentials = parseCredentials(entry);
      const setupCredentials = entry.setup
        ? parseCredentials(entry.setup)
        : undefined;
      if (
        credentials.keyType === "team" &&
        setupCredentials?.keyType === "team" &&
        credentials.issuerId !== setupCredentials.issuerId
      ) {
        throw new Error("Setup key belongs to another account");
      }
      accounts.push({
        id: entry.id,
        appAppleIds: entry.appAppleIds,
        credentials,
        setupCredentials,
      });
    }
  } catch {
    throw new Error(
      "App Store analytics configuration is invalid: APPLE_ANALYTICS_ACCOUNTS_JSON",
    );
  }
  return accounts;
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

export function getAppStoreAnalyticsSetupConfig(): AppStoreConnectConfig {
  const configured = [
    process.env.APPLE_ANALYTICS_SETUP_KEY_TYPE,
    process.env.APPLE_ANALYTICS_SETUP_ISSUER_ID,
    process.env.APPLE_ANALYTICS_SETUP_KEY_ID,
    process.env.APPLE_ANALYTICS_SETUP_PRIVATE_KEY,
    process.env.APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64,
  ].some((value) => value?.trim());
  if (!configured) {
    return getAppStoreAnalyticsConfig();
  }

  const schema = z.object({
    APPLE_ANALYTICS_SETUP_KEY_TYPE: z
      .enum(["team", "individual"])
      .default("team"),
    APPLE_ANALYTICS_SETUP_ISSUER_ID: z
      .string()
      .regex(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      )
      .optional(),
    APPLE_ANALYTICS_SETUP_KEY_ID: z
      .string()
      .min(3)
      .max(64)
      .regex(/^[A-Za-z0-9]+$/),
    APPLE_ANALYTICS_SETUP_PRIVATE_KEY: z
      .string()
      .min(100)
      .max(20_000)
      .optional(),
    APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64: z
      .string()
      .min(100)
      .max(20_000)
      .optional(),
  });
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `App Store analytics setup configuration is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  const rawKey = parsed.data.APPLE_ANALYTICS_SETUP_PRIVATE_KEY;
  const base64Key = parsed.data.APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64;
  if ((rawKey ? 1 : 0) + (base64Key ? 1 : 0) !== 1) {
    throw new Error(
      "App Store analytics setup configuration is invalid: set exactly one private-key variable",
    );
  }
  if (
    parsed.data.APPLE_ANALYTICS_SETUP_KEY_TYPE === "team" &&
    !parsed.data.APPLE_ANALYTICS_SETUP_ISSUER_ID
  ) {
    throw new Error(
      "App Store analytics setup configuration is invalid: team keys require APPLE_ANALYTICS_SETUP_ISSUER_ID",
    );
  }
  return {
    keyType: parsed.data.APPLE_ANALYTICS_SETUP_KEY_TYPE,
    issuerId: parsed.data.APPLE_ANALYTICS_SETUP_ISSUER_ID,
    keyId: parsed.data.APPLE_ANALYTICS_SETUP_KEY_ID,
    privateKey:
      rawKey ??
      decodePrivateKeyBase64(
        base64Key ?? "",
        "APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64",
      ),
  };
}
