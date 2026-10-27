import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/database";
import { deliverTelegramOutboxMessageNow } from "@/lib/delivery";
import { logBackendFailure, logBackendWarning } from "@/lib/diagnostics";
import { pollConfiguredCustomerReviews } from "@/lib/review-accounts";
import { queueStoredCustomerReviewNotifications } from "@/lib/reviews";
import type { StoredCustomerReviewWithApp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const notifySchema = z.enum(["true", "false"]).default("false");

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

function parseOptions(request: Request): { limit: number; notify: boolean } {
  const searchParams = new URL(request.url).searchParams;
  return {
    limit: limitSchema.parse(searchParams.get("limit") ?? undefined),
    notify:
      notifySchema.parse(searchParams.get("notify") ?? undefined) === "true",
  };
}

function reviewResponse(reviews: readonly StoredCustomerReviewWithApp[]) {
  return reviews.map((review) => ({
    id: review.id,
    app: {
      name: review.appName,
      bundleId: review.bundleId,
    },
    rating: review.rating,
    title: review.title,
    body: review.body,
    reviewerNickname: review.reviewerNickname,
    territory: review.territory,
    createdDate: review.createdDate,
    firstSeenAt: review.firstSeenAt,
  }));
}

export function GET(request: Request) {
  const startedAt = Date.now();
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const { limit } = parseOptions(request);
    return NextResponse.json(
      { reviews: reviewResponse(getDatabase().listCustomerReviews(limit)) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid limit or notify query value" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const errorId = logBackendFailure("admin_reviews_read_failed", error, {
      route: "admin/reviews",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Review API is unavailable", errorId },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const { limit, notify } = parseOptions(request);
    const failedApps: string[] = [];
    const skippedApps: string[] = [];
    const failureIds: string[] = [];
    const poll = await pollConfiguredCustomerReviews(getDatabase(), {
      onError: (app, error, context) => {
        failedApps.push(app.bundleId);
        failureIds.push(
          logBackendFailure("manual_review_poll_app_failed", error, {
            route: "admin/reviews",
            appBundleId: app.bundleId,
            appAppleId: app.appAppleId,
            ...context,
          }),
        );
      },
      onDeferred: (app, error, context) => {
        logBackendWarning("manual_review_poll_deferred", error, {
          route: "admin/reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
      onSkipped: (app, error, context) => {
        skippedApps.push(app.bundleId);
        logBackendWarning("manual_review_poll_app_skipped", error, {
          route: "admin/reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
    });
    const database = getDatabase();
    const reviews = database.listCustomerReviews(limit);
    const notifications = notify
      ? queueStoredCustomerReviewNotifications(database, reviews)
      : { queued: 0, outboxMessageIds: [] };
    if (notifications.outboxMessageIds.length > 0) {
      after(async () => {
        for (const id of notifications.outboxMessageIds) {
          await deliverTelegramOutboxMessageNow(database, id);
        }
      });
    }
    const ok = poll.failed === 0;
    return NextResponse.json(
      {
        ok,
        ...(ok ? {} : { errorId: failureIds[0], errorIds: failureIds }),
        poll,
        failedApps,
        skippedApps,
        notifications: {
          requested: notify,
          queued: notifications.queued,
          duplicatesSkipped: notify ? reviews.length - notifications.queued : 0,
        },
        reviews: reviewResponse(reviews),
      },
      {
        status: ok ? 200 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid limit or notify query value" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const errorId = logBackendFailure("manual_review_pull_error", error, {
      route: "admin/reviews",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Manual review pull failed", errorId },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
