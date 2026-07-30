import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
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
    console.error(
      JSON.stringify({
        event: "telegram_command_error",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Telegram command processing failed" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
