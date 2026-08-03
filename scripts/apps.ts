import { parseArgs } from "node:util";
import { AppDatabase } from "../src/lib/database";
import { deliverTelegramOutboxMessageNow } from "../src/lib/delivery";
import {
  appAppleIdSchema,
  appNameSchema,
  bundleIdSchema,
  type RegistryMutation,
  registerTrackedApp,
  removeTrackedApp,
} from "../src/lib/registry";

function help(): void {
  console.log(`Manage registered iOS apps.

Usage:
  npm run apps:dev -- add --name "My App" --bundle-id com.example.app --app-apple-id 123456789
  npm run apps:dev -- update --bundle-id com.example.app [--name "New name"] [--app-apple-id 987654321]
  npm run apps:dev -- list
  npm run apps:dev -- disable --bundle-id com.example.app
  npm run apps:dev -- enable --bundle-id com.example.app
  npm run apps:dev -- remove --bundle-id com.example.app

Use "npm run apps -- ..." instead after a production build.`);
}

function parseCommonOptions(args: string[]) {
  return parseArgs({
    args,
    options: {
      name: { type: "string" },
      "bundle-id": { type: "string" },
      "app-apple-id": { type: "string" },
    },
    strict: true,
  }).values;
}

function requireBundleId(value: string | undefined): string {
  return bundleIdSchema.parse(value);
}

function printApp(app: {
  name: string;
  bundleId: string;
  appAppleId: number;
  enabled: boolean;
}): void {
  console.log(
    `${app.enabled ? "enabled " : "disabled"}  ${app.name}  ${app.bundleId}  ${app.appAppleId}`,
  );
}

async function deliverRegistryNotification(
  database: AppDatabase,
  mutation: RegistryMutation,
): Promise<void> {
  if (!mutation.outboxMessageId) {
    return;
  }
  const outcome = await deliverTelegramOutboxMessageNow(
    database,
    mutation.outboxMessageId,
  );
  console.log(
    outcome === "delivered"
      ? "Telegram notification delivered."
      : outcome === "suppressed"
        ? "Telegram notification suppressed by policy."
        : "Telegram notification queued for retry.",
  );
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    help();
    return;
  }

  const database = new AppDatabase();
  try {
    if (command === "list") {
      const apps = database.listApps();
      if (apps.length === 0) {
        console.log("No apps registered.");
        return;
      }
      for (const app of apps) {
        printApp(app);
      }
      return;
    }

    const options = parseCommonOptions(args);
    const bundleId = requireBundleId(options["bundle-id"]);

    if (command === "add") {
      const mutation = registerTrackedApp(database, {
        name: appNameSchema.parse(options.name),
        bundleId,
        appAppleId: appAppleIdSchema.parse(options["app-apple-id"]),
      });
      console.log(`${mutation.action}:`);
      printApp(mutation.app);
      await deliverRegistryNotification(database, mutation);
      return;
    }

    if (command === "update") {
      if (!options.name && !options["app-apple-id"]) {
        throw new Error("Provide --name and/or --app-apple-id");
      }
      const current = database.getAppByBundleId(bundleId, true);
      if (!current) {
        throw new Error(`No app is registered for ${bundleId}`);
      }
      const mutation = registerTrackedApp(database, {
        bundleId,
        name: options.name ? appNameSchema.parse(options.name) : current.name,
        appAppleId: options["app-apple-id"]
          ? appAppleIdSchema.parse(options["app-apple-id"])
          : current.appAppleId,
      });
      console.log(`${mutation.action}:`);
      printApp(mutation.app);
      await deliverRegistryNotification(database, mutation);
      return;
    }

    if (command === "enable") {
      const current = database.getAppByBundleId(bundleId, true);
      if (!current) {
        throw new Error(`No app is registered for ${bundleId}`);
      }
      const mutation = registerTrackedApp(database, current);
      console.log(`${mutation.action}:`);
      printApp(mutation.app);
      await deliverRegistryNotification(database, mutation);
      return;
    }

    if (command === "disable" || command === "remove") {
      const mutation = removeTrackedApp(database, bundleId);
      if (!mutation) {
        throw new Error(`No app is registered for ${bundleId}`);
      }
      console.log(`${mutation.action}:`);
      printApp(mutation.app);
      await deliverRegistryNotification(database, mutation);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
