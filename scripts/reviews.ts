import { AppDatabase } from "../src/lib/database";
import { logBackendFailure, logBackendWarning } from "../src/lib/diagnostics";
import { pollConfiguredCustomerReviews } from "../src/lib/review-accounts";

const startedAt = Date.now();

async function main(): Promise<void> {
  const database = new AppDatabase();
  try {
    const result = await pollConfiguredCustomerReviews(database, {
      onError: (app, error, context) => {
        logBackendFailure("review_poll_app_failed", error, {
          task: "reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
      onDeferred: (app, error, context) => {
        logBackendWarning("review_poll_deferred", error, {
          task: "reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
      onSkipped: (app, error, context) => {
        logBackendWarning("review_poll_app_skipped", error, {
          task: "reviews",
          appBundleId: app.bundleId,
          appAppleId: app.appAppleId,
          ...context,
        });
      },
    });
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
