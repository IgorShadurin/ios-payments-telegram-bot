import { AnalyticsAccounts } from "../src/lib/analytics-accounts";
import { AppStoreAnalyticsError } from "../src/lib/app-store-analytics";
import { AppDatabase } from "../src/lib/database";

async function main(): Promise<void> {
  const database = new AppDatabase();
  try {
    const apps = database.listApps(false);
    if (apps.length === 0) {
      throw new Error("No enabled apps are registered");
    }
    const accounts = new AnalyticsAccounts();
    let created = 0;
    let existing = 0;
    for (const app of apps) {
      const client = accounts.forApp(app.appAppleId).getSetupClient();
      const current = await client.findOngoingReportRequest(app.appAppleId);
      if (current && !current.stopped) {
        existing += 1;
        console.log(`${app.bundleId}: ongoing analytics already enabled`);
        continue;
      }
      await client.createOngoingReportRequest(app.appAppleId);
      created += 1;
      console.log(`${app.bundleId}: requested ongoing analytics`);
    }
    console.log(JSON.stringify({ apps: apps.length, created, existing }));
  } finally {
    database.close();
  }
}

main().catch((error) => {
  if (error instanceof AppStoreAnalyticsError && error.status === 403) {
    console.error(
      "Analytics setup requires an App Store Connect Admin API key. Daily downloads can use a Sales and Reports key after setup.",
    );
  } else {
    console.error(
      error instanceof Error ? error.message : "Analytics setup failed",
    );
  }
  process.exitCode = 1;
});
