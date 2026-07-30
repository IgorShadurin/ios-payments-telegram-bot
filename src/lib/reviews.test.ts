import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./database";
import { formatCustomerReviewMessage, pollCustomerReviews } from "./reviews";
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
});
