import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./database";
import { escapeTelegramHtml } from "./message";
import type { RegisteredApp } from "./types";

export const bundleIdSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(
    /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/,
    "Bundle ID must look like com.example.app",
  );

export const appNameSchema = z
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

export const appAppleIdSchema = z.coerce.number().int().positive().safe();

export const trackedAppBodySchema = z
  .object({
    name: appNameSchema,
    appAppleId: appAppleIdSchema,
  })
  .strict();

export type RegistryAction = "registered" | "updated" | "removed" | "unchanged";

export interface RegistryMutation {
  action: RegistryAction;
  app: RegisteredApp;
  outboxMessageId?: number;
}

function registryMessage(
  action: Exclude<RegistryAction, "unchanged">,
  app: RegisteredApp,
) {
  const headings: Record<Exclude<RegistryAction, "unchanged">, string> = {
    registered: "📲 App registered for payment tracking",
    updated: "📝 Tracked app updated",
    removed: "🗑 App removed from payment tracking",
  };
  return [
    `<b>${headings[action]}</b>`,
    `<b>App:</b> ${escapeTelegramHtml(app.name)}`,
    `<b>Bundle ID:</b> ${escapeTelegramHtml(app.bundleId)}`,
    `<b>Apple ID:</b> ${app.appAppleId}`,
  ].join("\n");
}

function enqueueRegistryMessage(
  database: AppDatabase,
  action: Exclude<RegistryAction, "unchanged">,
  app: RegisteredApp,
): number {
  const deduplicationKey = `app-registry:${action}:${randomUUID()}`;
  return database.enqueueTelegramMessage(
    deduplicationKey,
    "app_registry",
    registryMessage(action, app),
  ).message.id;
}

export function registerTrackedApp(
  database: AppDatabase,
  input: { name: string; bundleId: string; appAppleId: number },
): RegistryMutation {
  const name = appNameSchema.parse(input.name);
  const bundleId = bundleIdSchema.parse(input.bundleId);
  const appAppleId = appAppleIdSchema.parse(input.appAppleId);

  return database.transaction(() => {
    const current = database.getAppByBundleId(bundleId, true);
    if (
      current?.enabled &&
      current.name === name &&
      current.appAppleId === appAppleId
    ) {
      return { action: "unchanged", app: current };
    }

    let app: RegisteredApp;
    let action: Exclude<RegistryAction, "removed" | "unchanged">;
    if (!current) {
      app = database.addApp(name, bundleId, appAppleId);
      action = "registered";
    } else {
      app =
        database.updateApp(bundleId, { name, appAppleId }) ??
        (() => {
          throw new Error("Tracked app disappeared during update");
        })();
      if (!app.enabled) {
        app =
          database.setAppEnabled(bundleId, true) ??
          (() => {
            throw new Error("Tracked app disappeared while enabling");
          })();
        action = "registered";
      } else {
        action = "updated";
      }
    }

    return {
      action,
      app,
      outboxMessageId: enqueueRegistryMessage(database, action, app),
    };
  });
}

export function removeTrackedApp(
  database: AppDatabase,
  bundleIdInput: string,
): RegistryMutation | undefined {
  const bundleId = bundleIdSchema.parse(bundleIdInput);
  return database.transaction(() => {
    const current = database.getAppByBundleId(bundleId, true);
    if (!current) {
      return undefined;
    }
    if (!current.enabled) {
      return { action: "unchanged", app: current };
    }
    const app = database.setAppEnabled(bundleId, false);
    if (!app) {
      throw new Error("Tracked app disappeared while removing");
    }
    return {
      action: "removed",
      app,
      outboxMessageId: enqueueRegistryMessage(database, "removed", app),
    };
  });
}
