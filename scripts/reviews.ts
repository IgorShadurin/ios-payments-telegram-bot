import {
  createAppStoreConnectToken,
  fetchCustomerReviewPage,
} from "../src/lib/app-store-connect";
import { getAppStoreConnectConfig } from "../src/lib/config";
import { AppDatabase } from "../src/lib/database";
import { pollCustomerReviews } from "../src/lib/reviews";

async function main(): Promise<void> {
  const config = getAppStoreConnectConfig();
  const token = createAppStoreConnectToken(config);
  const database = new AppDatabase();
  try {
    const result = await pollCustomerReviews(
      database,
      (appAppleId, nextUrl) =>
        fetchCustomerReviewPage(appAppleId, token, nextUrl),
      (app, error) => {
        const message =
          error instanceof Error ? error.message : "Unknown review poll error";
        console.error(`${app.bundleId}: ${message}`);
      },
    );
    console.log(JSON.stringify(result));
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Customer review polling failed",
  );
  process.exitCode = 1;
});
