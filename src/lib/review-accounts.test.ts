import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStoreConnectError } from "./app-store-connect";
import type { ReviewAccountConfig } from "./config";
import { AppDatabase } from "./database";
import { pollConfiguredCustomerReviews } from "./review-accounts";
import type { CustomerReview } from "./types";

let directory: string;
let database: AppDatabase;
const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
const accounts: ReviewAccountConfig[] = [
  {
    id: "default",
    appAppleIds: [],
    credentials: {
      keyType: "team",
      issuerId: "old-issuer",
      keyId: "OLDKEY",
      privateKey,
    },
  },
  {
    id: "wowcoded",
    appAppleIds: [6801154513],
    credentials: {
      keyType: "team",
      issuerId: "new-issuer",
      keyId: "NEWKEY",
      privateKey,
    },
  },
];
const review: CustomerReview = {
  id: "existing",
  rating: 5,
  title: "Great",
  body: "Useful",
  reviewerNickname: "Rider",
  territory: "USA",
  createdDate: "2026-10-27T10:00:00Z",
};

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "review-accounts-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
  database.addApp("Original", "com.example.original", 123456789);
  database.addApp("Bike Tracker", "com.wowcoded.speedometergps", 6801154513);
});
afterEach(() => {
  vi.unstubAllGlobals();
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("review accounts", () => {
  it("signs each app's requests with its owning account and keeps the shared history/outbox", async () => {
    const app = database.getAppByBundleId("com.wowcoded.speedometergps");
    if (!app) throw new Error("Missing app");
    database.storeCustomerReviewBatch(app.id, [
      { ...review, messageHtml: "Baseline" },
    ]);
    const requests: Array<{ app: string; keyId: string; issuer: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const jwt = new Headers(init.headers)
          .get("authorization")
          ?.slice(7)
          .split(".");
        if (!jwt) throw new Error("Missing token");
        requests.push({
          app: url.pathname,
          keyId: JSON.parse(Buffer.from(jwt[0], "base64url").toString()).kid,
          issuer: JSON.parse(Buffer.from(jwt[1], "base64url").toString()).iss,
        });
        const reviews = url.pathname.includes("6801154513")
          ? [{ ...review, id: "new" }, review]
          : [];
        return Response.json({
          data: reviews.map(({ id, ...attributes }) => ({
            id,
            type: "customerReviews",
            attributes,
          })),
          links: {},
        });
      }),
    );
    await expect(
      pollConfiguredCustomerReviews(database, {}, accounts),
    ).resolves.toMatchObject({
      apps: 2,
      attemptedApps: 2,
      baselineApps: 1,
      stored: 1,
      queued: 1,
      failed: 0,
      accounts: [
        { accountId: "default", apps: 1 },
        { accountId: "wowcoded", apps: 1, baselineApps: 0, queued: 1 },
      ],
    });
    expect(requests).toEqual([
      {
        app: "/v1/apps/123456789/customerReviews",
        keyId: "OLDKEY",
        issuer: "old-issuer",
      },
      {
        app: "/v1/apps/6801154513/customerReviews",
        keyId: "NEWKEY",
        issuer: "new-issuer",
      },
    ]);
    expect(database.pendingTelegramOutboxCount()).toBe(1);
    expect(
      database.getTelegramOutboxMessageByKey("app-review:new"),
    ).toMatchObject({
      deliveryStatus: "pending",
      messageHtml: expect.stringContaining("Bike Tracker"),
    });
    expect(
      database.getTelegramOutboxMessageByKey("app-review:existing"),
    ).toBeUndefined();
  });

  it.each([
    401, 403, 429,
  ])("isolates HTTP %s failures to their account", async (status) => {
    const onError = vi.fn();
    const onDeferred = vi.fn();
    const fetchers = new Map(
      accounts.map((account) => [
        account.id,
        vi.fn(async () => {
          if (account.id === "default")
            throw new AppStoreConnectError("Rejected", status);
          return { reviews: [] };
        }),
      ]),
    );
    await expect(
      pollConfiguredCustomerReviews(
        database,
        { onError, onDeferred },
        accounts,
        (account) => {
          const fetcher = fetchers.get(account.id);
          if (!fetcher) throw new Error("Missing test account");
          return fetcher;
        },
      ),
    ).resolves.toMatchObject({
      apps: 2,
      attemptedApps: 2,
      baselineApps: 1,
      failed: status === 429 ? 0 : 1,
      deferred: status === 429,
    });
    expect(fetchers.get("wowcoded")).toHaveBeenCalledExactlyOnceWith(
      6801154513,
      undefined,
    );
    expect(status === 429 ? onDeferred : onError).toHaveBeenCalledWith(
      expect.objectContaining({ appAppleId: 123456789 }),
      expect.objectContaining({ status }),
      expect.objectContaining({ accountId: "default" }),
    );
  });
});
