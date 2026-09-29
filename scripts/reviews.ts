import {
  createAppStoreConnectToken,
  fetchCustomerReviewPage,
} from "../src/lib/app-store-connect";
import { getAppStoreConnectConfig } from "../src/lib/config";
import { AppDatabase } from "../src/lib/database";
import { logBackendFailure, logBackendWarning } from "../src/lib/diagnostics";
import { pollCustomerReviews } from "../src/lib/reviews";

const startedAt = Date.now();

async function main(): Promise<void> {
  const config = getAppStoreConnectConfig();
  const token = () => createAppStoreConnectToken(config);
  const database = new AppDatabase();
  try {
    const result = await pollCustomerReviews(
      database,
      (appAppleId, nextUrl) =>
        fetchCustomerReviewPage(appAppleId, token, nextUrl),
      (app, error, context) => {
        logBackendFailure("review_poll_app_failed", error, {
          task: "reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
      (app, error, context) => {
        logBackendWarning("review_poll_deferred", error, {
          task: "reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
    );
    console.log(
      JSON.stringify({ ...result, durationMs: Date.now() - startedAt }),
    );
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
}

main().catch((error) => {
  logBackendFailure("review_poll_failed", error, {
    task: "reviews",
    durationMs: Date.now() - startedAt,
  });
  process.exitCode = 1;
});
