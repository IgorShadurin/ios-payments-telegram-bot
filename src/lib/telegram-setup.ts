import { z } from "zod";
import { getTelegramConfig, getTelegramWebhookConfig } from "./config";
import { telegramBotCommands } from "./telegram-commands";

const telegramApiResponseSchema = z
  .object({
    ok: z.boolean(),
    description: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();

const webhookInfoSchema = z.object({
  url: z.string(),
  pending_update_count: z.number().int().nonnegative(),
  last_error_message: z.string().optional(),
  allowed_updates: z.array(z.string()).optional(),
});

async function callTelegramApi(
  method: string,
  body: Record<string, unknown> = {},
): Promise<unknown> {
  const { botToken } = getTelegramConfig();
  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(botToken)}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new Error(`Telegram ${method} request failed`);
  }

  const parsed = telegramApiResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const description =
      parsed.success && parsed.data.description
        ? parsed.data.description.slice(0, 200)
        : `HTTP ${response.status}`;
    throw new Error(`Telegram ${method} failed: ${description}`);
  }
  return parsed.data.result;
}

export async function configureTelegramBot(webhookUrl: string): Promise<{
  webhookUrl: string;
  commandScopes: number;
  pendingUpdates: number;
  allowedUpdates: string[];
}> {
  const webhookConfig = getTelegramWebhookConfig();
  await callTelegramApi("setWebhook", {
    url: webhookUrl,
    secret_token: webhookConfig.secretToken,
    allowed_updates: ["message"],
    drop_pending_updates: true,
    max_connections: 10,
  });

  await callTelegramApi("deleteMyCommands", {
    scope: { type: "default" },
  });
  await callTelegramApi("deleteMyCommands", {
    scope: { type: "all_private_chats" },
  });

  for (const userId of webhookConfig.allowedUserIds) {
    await callTelegramApi("setMyCommands", {
      commands: telegramBotCommands,
      scope: { type: "chat", chat_id: Number(userId) },
    });
  }

  const info = webhookInfoSchema.parse(await callTelegramApi("getWebhookInfo"));
  if (info.url !== webhookUrl) {
    throw new Error("Telegram webhook URL did not verify");
  }
  return {
    webhookUrl: info.url,
    commandScopes: webhookConfig.allowedUserIds.size,
    pendingUpdates: info.pending_update_count,
    allowedUpdates: info.allowed_updates ?? [],
  };
}
