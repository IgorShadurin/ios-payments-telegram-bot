import { parseArgs } from "node:util";
import { z } from "zod";
import { AppDatabase } from "../src/lib/database";

const bundleIdSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(
    /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/,
    "Bundle ID must look like com.example.app",
  );
const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      [...name].every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint >= 32 && codePoint !== 127;
      }),
    "Name cannot contain control characters",
  );
const appleIdSchema = z.coerce.number().int().positive().safe();

function help(): void {
  console.log(`Manage registered iOS apps.

Usage:
  npm run apps:dev -- add --name "My App" --bundle-id com.example.app --app-apple-id 123456789
  npm run apps:dev -- update --bundle-id com.example.app [--name "New name"] [--app-apple-id 987654321]
  npm run apps:dev -- list
  npm run apps:dev -- disable --bundle-id com.example.app
  npm run apps:dev -- enable --bundle-id com.example.app

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

function main(): void {
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
      const app = database.addApp(
        nameSchema.parse(options.name),
        bundleId,
        appleIdSchema.parse(options["app-apple-id"]),
      );
      console.log("Added:");
      printApp(app);
      return;
    }

    if (command === "update") {
      if (!options.name && !options["app-apple-id"]) {
        throw new Error("Provide --name and/or --app-apple-id");
      }
      const app = database.updateApp(bundleId, {
        name: options.name ? nameSchema.parse(options.name) : undefined,
        appAppleId: options["app-apple-id"]
          ? appleIdSchema.parse(options["app-apple-id"])
          : undefined,
      });
      if (!app) {
        throw new Error(`No app is registered for ${bundleId}`);
      }
      console.log("Updated:");
      printApp(app);
      return;
    }

    if (command === "enable" || command === "disable") {
      const app = database.setAppEnabled(bundleId, command === "enable");
      if (!app) {
        throw new Error(`No app is registered for ${bundleId}`);
      }
      console.log(`${command === "enable" ? "Enabled" : "Disabled"}:`);
      printApp(app);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
