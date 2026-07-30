import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import {
  createAppStoreConnectToken,
  fetchCustomerReviewPage,
} from "@/lib/app-store-connect";
import { getAppStoreConnectConfig } from "@/lib/config";
import { getDatabase } from "@/lib/database";
import { pollCustomerReviews } from "@/lib/reviews";

export const runtime = "nodejs";
export const maxDuration = 120;

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);

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

function parseLimit(request: Request): number {
  const value = new URL(request.url).searchParams.get("limit") ?? undefined;
  return limitSchema.parse(value);
}

function reviewResponse(limit: number) {
  return getDatabase()
    .listCustomerReviews(limit)
    .map((review) => ({
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
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const limit = parseLimit(request);
    return NextResponse.json(
      { reviews: reviewResponse(limit) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "limit must be an integer from 1 to 200" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Review API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    const limit = parseLimit(request);
    const config = getAppStoreConnectConfig();
    const token = createAppStoreConnectToken(config);
    const failedApps: string[] = [];
    const poll = await pollCustomerReviews(
      getDatabase(),
      (appAppleId, nextUrl) =>
        fetchCustomerReviewPage(appAppleId, token, nextUrl),
      (app) => {
        failedApps.push(app.bundleId);
      },
    );
    const ok = poll.failed === 0;
    return NextResponse.json(
      {
        ok,
        poll,
        failedApps,
        reviews: reviewResponse(limit),
      },
      {
        status: ok ? 200 : 502,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "limit must be an integer from 1 to 200" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    console.error(
      JSON.stringify({
        event: "manual_review_pull_error",
        error: error instanceof Error ? error.name : "UnknownError",
      }),
    );
    return NextResponse.json(
      { error: "Manual review pull failed" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
