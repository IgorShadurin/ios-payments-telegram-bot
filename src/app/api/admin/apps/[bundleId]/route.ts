import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/database";
import { deliverTelegramOutboxMessageNow } from "@/lib/delivery";
import {
  bundleIdSchema,
  registerTrackedApp,
  removeTrackedApp,
  trackedAppBodySchema,
} from "@/lib/registry";
import { RequestBodyError, readJsonBody } from "@/lib/request";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ bundleId: string }>;
}

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": "Bearer",
      },
    },
  );
}

function responseBody(mutation: ReturnType<typeof registerTrackedApp>) {
  return {
    ok: true,
    action: mutation.action,
    app: {
      name: mutation.app.name,
      bundleId: mutation.app.bundleId,
      appAppleId: mutation.app.appAppleId,
      enabled: mutation.app.enabled,
    },
    telegramNotification:
      mutation.action === "unchanged" ? "not-needed" : "queued",
  };
}

function deliverAfterResponse(outboxMessageId?: number) {
  if (!outboxMessageId) {
    return;
  }
  const database = getDatabase();
  after(async () => {
    await deliverTelegramOutboxMessageNow(database, outboxMessageId);
  });
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const { bundleId: encodedBundleId } = await context.params;
    const bundleId = bundleIdSchema.parse(decodeURIComponent(encodedBundleId));
    const body = trackedAppBodySchema.safeParse(
      await readJsonBody(request, 8_192),
    );
    if (!body.success) {
      return NextResponse.json(
        { error: "Invalid app registration body" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }

    const mutation = registerTrackedApp(getDatabase(), {
      bundleId,
      ...body.data,
    });
    deliverAfterResponse(mutation.outboxMessageId);
    return NextResponse.json(responseBody(mutation), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof z.ZodError || error instanceof URIError) {
      return NextResponse.json(
        { error: "Invalid bundle ID" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    console.error(
      JSON.stringify({
        event: "admin_app_registration_error",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const { bundleId: encodedBundleId } = await context.params;
    const bundleId = bundleIdSchema.parse(decodeURIComponent(encodedBundleId));
    const mutation = removeTrackedApp(getDatabase(), bundleId);
    if (!mutation) {
      return NextResponse.json(
        { error: "App is not registered" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
    deliverAfterResponse(mutation.outboxMessageId);
    return NextResponse.json(responseBody(mutation), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof URIError) {
      return NextResponse.json(
        { error: "Invalid bundle ID" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    console.error(
      JSON.stringify({
        event: "admin_app_removal_error",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
