import {
  createAppStoreConnectToken,
  fetchCustomerReviewPage,
} from "./app-store-connect";
import { getReviewAccountConfigs, type ReviewAccountConfig } from "./config";
import type { AppDatabase } from "./database";
import {
  pollCustomerReviews,
  type ReviewPageFetcher,
  type ReviewPollDeferredContext,
  type ReviewPollErrorContext,
  type ReviewPollResult,
  type ReviewPollSkippedContext,
} from "./reviews";
import type { RegisteredApp } from "./types";

type AccountContext<T> = T & { accountId: string };
interface ReviewAccountCallbacks {
  onError?: (
    app: RegisteredApp,
    error: unknown,
    context: AccountContext<ReviewPollErrorContext>,
  ) => void;
  onDeferred?: (
    app: RegisteredApp,
    error: unknown,
    context: AccountContext<ReviewPollDeferredContext>,
  ) => void;
  onSkipped?: (
    app: RegisteredApp,
    error: unknown,
    context: AccountContext<ReviewPollSkippedContext>,
  ) => void;
}

export interface AccountReviewPollResult extends ReviewPollResult {
  accounts: Array<ReviewPollResult & { accountId: string }>;
}

export async function pollConfiguredCustomerReviews(
  database: AppDatabase,
  callbacks: ReviewAccountCallbacks = {},
  accounts = getReviewAccountConfigs(),
  createFetcher: (account: ReviewAccountConfig) => ReviewPageFetcher = (
    account,
  ) => {
    const token = () => createAppStoreConnectToken(account.credentials);
    return (appAppleId, nextUrl) =>
      fetchCustomerReviewPage(appAppleId, token, nextUrl);
  },
): Promise<AccountReviewPollResult> {
  const apps = database.listApps(false);
  const assignments = new Map(
    accounts.flatMap((account) =>
      account.appAppleIds.map((id) => [id, account.id] as const),
    ),
  );
  const result: AccountReviewPollResult = {
    apps: 0,
    attemptedApps: 0,
    baselineApps: 0,
    stored: 0,
    queued: 0,
    skipped: 0,
    failed: 0,
    deferred: false,
    accounts: [],
  };
  for (const account of accounts) {
    const appAppleIds = new Set(
      apps
        .filter(
          (app) =>
            (assignments.get(app.appAppleId) ?? "default") === account.id,
        )
        .map((app) => app.appAppleId),
    );
    if (appAppleIds.size === 0) continue;
    const context = <T>(value: T): AccountContext<T> => ({
      ...value,
      accountId: account.id,
    });
    const poll = await pollCustomerReviews(
      database,
      createFetcher(account),
      (app, error, value) => callbacks.onError?.(app, error, context(value)),
      (app, error, value) => callbacks.onDeferred?.(app, error, context(value)),
      (app, error, value) => callbacks.onSkipped?.(app, error, context(value)),
      appAppleIds,
    );
    result.accounts.push({ accountId: account.id, ...poll });
    for (const field of [
      "apps",
      "attemptedApps",
      "baselineApps",
      "stored",
      "queued",
      "skipped",
      "failed",
    ] as const) {
      result[field] += poll[field];
    }
    if (poll.deferred) {
      result.deferred = true;
      result.deferredReason ??= poll.deferredReason;
    }
  }
  return result;
}
