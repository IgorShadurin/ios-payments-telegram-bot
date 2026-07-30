import { after, NextResponse } from "next/server";
import { z } from "zod";
import { AppleNotificationError, verifyAppleNotification } from "@/lib/apple";
import { getDatabase } from "@/lib/database";
import { deliverNotificationNow } from "@/lib/delivery";
import { formatTelegramMessage } from "@/lib/message";
import { RequestBodyError, readJsonBody } from "@/lib/request";

export const runtime = "nodejs";

const bodySchema = z.object({
  signedPayload: z.string().min(32).max(500_000),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.safeParse(await readJsonBody(request));
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid notification body" },
        { status: 400 },
      );
    }

    const database = getDatabase();
    const verified = await verifyAppleNotification(
      body.data.signedPayload,
      database,
    );
    const stored = database.insertNotification({
      appId: verified.app.id,
      event: verified.event,
      messageHtml: formatTelegramMessage(
        verified.app,
        verified.event,
        verified.event.currency
          ? database.getExchangeRate(verified.event.currency)
          : undefined,
      ),
    });

    after(async () => {
      await deliverNotificationNow(database, stored.notification.id);
    });

    console.info(
      JSON.stringify({
        event: "apple_notification_accepted",
        notificationUuid: verified.event.notificationUuid,
        notificationType: verified.event.notificationType,
        app: verified.app.bundleId,
        duplicate: !stored.created,
      }),
    );
    return NextResponse.json({
      ok: true,
      duplicate: !stored.created,
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof AppleNotificationError) {
      const status = error.code === "UNREGISTERED_APP" ? 404 : 401;
      console.warn(
        JSON.stringify({
          event: "apple_notification_rejected",
          code: error.code,
        }),
      );
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error(
      JSON.stringify({
        event: "apple_notification_error",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
