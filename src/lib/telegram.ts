import fs from "node:fs/promises";
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

const telegramMediaGroupResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z
    .array(
      z.object({
        message_id: z.number().int(),
      }),
    )
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

export interface TelegramMessageOptions {
  chatId?: string;
  messageThreadId?: number;
  replyToMessageId?: number;
}

export async function sendTelegramMessage(
  messageHtml: string,
  options: TelegramMessageOptions = {},
): Promise<number> {
  const config = getTelegramConfig();
  const requestBody: Record<string, unknown> = {
    chat_id: options.chatId ?? config.chatId,
    text: messageHtml,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  const messageThreadId =
    options.messageThreadId ??
    (options.chatId === undefined ? config.messageThreadId : undefined);
  if (messageThreadId) {
    requestBody.message_thread_id = messageThreadId;
  }
  if (options.replyToMessageId) {
    requestBody.reply_parameters = {
      message_id: options.replyToMessageId,
      allow_sending_without_reply: true,
    };
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

export async function sendTelegramPhoto(
  imagePath: string,
  caption: string,
  options: TelegramMessageOptions = {},
): Promise<number> {
  const config = getTelegramConfig();
  const image = await fs.readFile(imagePath);
  if (image.length === 0 || image.length > 10 * 1024 * 1024) {
    throw new TelegramDeliveryError(
      "Telegram report image must be between 1 byte and 10 MB",
    );
  }
  const body = new FormData();
  body.set("chat_id", options.chatId ?? config.chatId);
  body.set("photo", new Blob([image], { type: "image/png" }), "report.png");
  body.set("caption", caption);
  body.set("parse_mode", "HTML");
  const messageThreadId =
    options.messageThreadId ??
    (options.chatId === undefined ? config.messageThreadId : undefined);
  if (messageThreadId) {
    body.set("message_thread_id", String(messageThreadId));
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendPhoto`,
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new TelegramDeliveryError("Telegram photo request failed");
  }

  const responseBody: unknown = await response.json().catch(() => undefined);
  const parsed = telegramResponseSchema.safeParse(responseBody);
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
      `Telegram rejected the photo: ${description}`,
      parsed.success ? parsed.data.parameters?.retry_after : undefined,
    );
  }
  return parsed.data.result.message_id;
}

export async function sendTelegramPhotoGroup(
  imagePaths: readonly string[],
  caption: string,
  options: TelegramMessageOptions = {},
): Promise<number[]> {
  if (imagePaths.length === 1) {
    return [await sendTelegramPhoto(imagePaths[0], caption, options)];
  }
  if (imagePaths.length < 2 || imagePaths.length > 10) {
    throw new TelegramDeliveryError(
      "A Telegram photo group must contain between 2 and 10 images",
    );
  }
  const config = getTelegramConfig();
  const images = await Promise.all(
    imagePaths.map((imagePath) => fs.readFile(imagePath)),
  );
  if (
    images.some(
      (image) => image.length === 0 || image.length > 10 * 1024 * 1024,
    )
  ) {
    throw new TelegramDeliveryError(
      "Each Telegram report image must be between 1 byte and 10 MB",
    );
  }
  const body = new FormData();
  body.set("chat_id", options.chatId ?? config.chatId);
  body.set(
    "media",
    JSON.stringify(
      images.map((_, index) => ({
        type: "photo",
        media: `attach://photo${index}`,
        ...(index === 0 ? { caption, parse_mode: "HTML" } : {}),
      })),
    ),
  );
  images.forEach((image, index) => {
    body.set(
      `photo${index}`,
      new Blob([image], { type: "image/png" }),
      `report-page-${index + 1}.png`,
    );
  });
  const messageThreadId =
    options.messageThreadId ??
    (options.chatId === undefined ? config.messageThreadId : undefined);
  if (messageThreadId) {
    body.set("message_thread_id", String(messageThreadId));
  }

  let response: Response;
  try {
    response = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(config.botToken)}/sendMediaGroup`,
      {
        method: "POST",
        body,
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new TelegramDeliveryError("Telegram photo-group request failed");
  }

  const responseBody: unknown = await response.json().catch(() => undefined);
  const parsed = telegramMediaGroupResponseSchema.safeParse(responseBody);
  if (
    !parsed.success ||
    !response.ok ||
    !parsed.data.ok ||
    !parsed.data.result ||
    parsed.data.result.length !== imagePaths.length
  ) {
    const description =
      parsed.success && parsed.data.description
        ? parsed.data.description.slice(0, 200)
        : `HTTP ${response.status}`;
    throw new TelegramDeliveryError(
      `Telegram rejected the photo group: ${description}`,
      parsed.success ? parsed.data.parameters?.retry_after : undefined,
    );
  }
  return parsed.data.result.map((message) => message.message_id);
}
