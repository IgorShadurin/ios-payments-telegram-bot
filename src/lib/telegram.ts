import { z } from "zod";
import { getTelegramConfig } from "./config";

const telegramResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z
    .object({
      message_id: z.number().int(),
    })
    .optional(),
  parameters: z
    .object({
      retry_after: z.number().int().positive().optional(),
    })
    .optional(),
});

export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

export async function sendTelegramMessage(
  messageHtml: string,
): Promise<number> {
  const config = getTelegramConfig();
  const requestBody: Record<string, unknown> = {
    chat_id: config.chatId,
    text: messageHtml,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (config.messageThreadId) {
    requestBody.message_thread_id = config.messageThreadId;
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new TelegramDeliveryError("Telegram request failed");
  }

  const body: unknown = await response.json().catch(() => undefined);
  const parsed = telegramResponseSchema.safeParse(body);
  if (
    !parsed.success ||
    !response.ok ||
    !parsed.data.ok ||
    !parsed.data.result
  ) {
    const description =
      parsed.success && parsed.data.description
        ? parsed.data.description.slice(0, 200)
        : `HTTP ${response.status}`;
    throw new TelegramDeliveryError(
      `Telegram rejected the message: ${description}`,
      parsed.success ? parsed.data.parameters?.retry_after : undefined,
    );
  }
  return parsed.data.result.message_id;
}
