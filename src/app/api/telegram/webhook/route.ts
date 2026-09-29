import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
import { logBackendFailure } from "@/lib/diagnostics";
import { RequestBodyError, readJsonBody } from "@/lib/request";
import { sendTelegramMessage } from "@/lib/telegram";
import { responseForTelegramMessage } from "@/lib/telegram-commands";
import {
  isApprovedPrivateMessage,
  isTelegramWebhookAuthorized,
  telegramUpdateSchema,
} from "@/lib/telegram-webhook";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    if (!isTelegramWebhookAuthorized(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: noStoreHeaders },
      );
    }

    const update = telegramUpdateSchema.safeParse(
      await readJsonBody(request, 64 * 1024),
    );
    if (!update.success) {
      return NextResponse.json(
        { error: "Invalid Telegram update" },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const message = update.data.message;
    if (!message || !isApprovedPrivateMessage(message)) {
      return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
    }

    const response = responseForTelegramMessage(
      message.text,
      getDatabase().listApps(false),
    );
    await sendTelegramMessage(response, {
      chatId: String(message.chat.id),
      replyToMessageId: message.message_id,
    });
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: noStoreHeaders },
      );
    }
    const errorId = logBackendFailure("telegram_command_error", error, {
      route: "telegram/webhook",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Telegram command processing failed", errorId },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
