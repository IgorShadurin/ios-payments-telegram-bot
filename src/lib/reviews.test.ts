import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectError } from "./app-store-connect";
import { AppDatabase } from "./database";
import {
  formatCustomerReviewMessage,
  pollCustomerReviews,
  queueStoredCustomerReviewNotifications,
} from "./reviews";
import type { CustomerReview } from "./types";

let directory: string;
let database: AppDatabase;

function review(id: string, body = "Very useful"): CustomerReview {
  return {
    id,
    rating: 4,
    title: "Good app",
    body,
    reviewerNickname: "Someone",
    territory: "USA",
    createdDate: "2026-07-30T10:00:00Z",
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ios-reviews-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
  database.addApp("Example", "com.example.app", 123456789);
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("customer review polling", () => {
  it("creates a silent baseline, then queues only new reviews", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ reviews: [review("old-review")] })
      .mockResolvedValueOnce({
        reviews: [review("new-review"), review("old-review")],
      });

    expect(await pollCustomerReviews(database, fetchPage)).toMatchObject({
      apps: 1,
      baselineApps: 1,
      stored: 1,
      queued: 0,
      failed: 0,
    });
    expect(database.pendingTelegramOutboxCount()).toBe(0);

    expect(await pollCustomerReviews(database, fetchPage)).toMatchObject({
      apps: 1,
      baselineApps: 0,
      stored: 1,
      queued: 1,
      failed: 0,
    });
    expect(database.customerReviewCount()).toBe(2);
    expect(
      database.getTelegramOutboxMessageByKey("app-review:new-review"),
    ).toMatchObject({
      category: "app_review",
      deliveryStatus: "pending",
    });
  });

  it("defers the cycle without failing after an exhausted rate limit", async () => {
    database.addApp("Second", "com.example.second", 987654321);
    const fetchPage = vi.fn(async () => {
      throw new AppStoreConnectError(
        "App Store Connect rejected the request with HTTP 429",
        429,
      );
    });
    const onError = vi.fn();

    await expect(
      pollCustomerReviews(database, fetchPage, onError),
    ).resolves.toEqual({
      apps: 2,
      attemptedApps: 1,
      baselineApps: 0,
      stored: 0,
      queued: 0,
      failed: 0,
      deferred: true,
      deferredReason: "rate_limit",
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("defers temporary Apple server failures to the next cycle", async () => {
    const fetchPage = vi.fn(async () => {
      throw new AppStoreConnectError(
        "App Store Connect rejected the request with HTTP 500",
        500,
      );
    });

    await expect(
      pollCustomerReviews(database, fetchPage),
    ).resolves.toMatchObject({
      failed: 0,
      deferred: true,
      deferredReason: "temporary_unavailable",
    });
  });

  it("stops before exhausting Apple's reported rate-limit headroom", async () => {
    database.addApp("Second", "com.example.second", 987654321);
    const fetchPage = vi.fn(async () => ({
      reviews: [],
      rateLimitRemaining: 10,
    }));

    await expect(
      pollCustomerReviews(database, fetchPage),
    ).resolves.toMatchObject({
      apps: 2,
      attemptedApps: 1,
      baselineApps: 1,
      failed: 0,
      deferred: true,
      deferredReason: "rate_limit_headroom",
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("reports one authentication failure and stops the cycle", async () => {
    database.addApp("Second", "com.example.second", 987654321);
    const fetchPage = vi.fn(async () => {
      throw new AppStoreConnectError(
        "App Store Connect rejected the request with HTTP 401",
        401,
      );
    });
    const onError = vi.fn();

    await expect(
      pollCustomerReviews(database, fetchPage, onError),
    ).resolves.toMatchObject({
      apps: 2,
      attemptedApps: 1,
      failed: 1,
      deferred: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("escapes review content before placing it in Telegram HTML", () => {
    const app = database.getAppByBundleId("com.example.app");
    if (!app) {
      throw new Error("Test app not found");
    }
    const message = formatCustomerReviewMessage(
      app,
      review("unsafe", '<b>fake</b> & "instructions"'),
    );

    expect(message).toContain("&lt;b&gt;fake&lt;/b&gt; &amp;");
    expect(message).not.toContain("<b>fake</b>");
    expect(message).toContain("★★★★☆ (4/5)");
  });

  it("manually queues a baseline review once without creating duplicates", () => {
    const app = database.getAppByBundleId("com.example.app");
    if (!app) {
      throw new Error("Test app not found");
    }
    database.storeCustomerReviewBatch(app.id, [
      {
        ...review("baseline-review"),
        messageHtml: "<b>silent baseline</b>",
      },
    ]);
    const stored = database.listCustomerReviews();

    expect(
      queueStoredCustomerReviewNotifications(database, stored),
    ).toMatchObject({ queued: 1 });
    expect(queueStoredCustomerReviewNotifications(database, stored)).toEqual({
      queued: 0,
      outboxMessageIds: [],
    });
    expect(
      database.getTelegramOutboxMessageByKey("app-review:baseline-review"),
    ).toMatchObject({
      category: "app_review",
      deliveryStatus: "pending",
      messageHtml: expect.stringContaining("Existing App Store review"),
    });
  });
});
