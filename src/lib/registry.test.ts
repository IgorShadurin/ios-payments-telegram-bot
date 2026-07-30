import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";
import { registerTrackedApp, removeTrackedApp } from "./registry";

let directory: string;
let database: AppDatabase;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ios-registry-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("tracked app registry", () => {
  it("registers idempotently and queues one audit message", () => {
    const input = {
      name: "Example App",
      bundleId: "com.example.app",
      appAppleId: 123456789,
    };
    const registered = registerTrackedApp(database, input);
    expect(registered).toMatchObject({
      action: "registered",
      app: { enabled: true, ...input },
    });
    expect(registered.outboxMessageId).toBeTypeOf("number");

    const unchanged = registerTrackedApp(database, input);
    expect(unchanged).toMatchObject({
      action: "unchanged",
      app: { enabled: true, ...input },
    });
    expect(unchanged.outboxMessageId).toBeUndefined();
    expect(database.pendingTelegramOutboxCount()).toBe(1);
  });

  it("updates and soft-removes an app while preserving its record", () => {
    registerTrackedApp(database, {
      name: "Example App",
      bundleId: "com.example.app",
      appAppleId: 123456789,
    });
    const updated = registerTrackedApp(database, {
      name: "Renamed App",
      bundleId: "com.example.app",
      appAppleId: 987654321,
    });
    expect(updated.action).toBe("updated");

    const removed = removeTrackedApp(database, "com.example.app");
    expect(removed).toMatchObject({
      action: "removed",
      app: { enabled: false, name: "Renamed App", appAppleId: 987654321 },
    });
    expect(database.getAppByBundleId("com.example.app")).toBeUndefined();
    expect(database.getAppByBundleId("com.example.app", true)).toMatchObject({
      enabled: false,
    });

    expect(removeTrackedApp(database, "com.example.app")?.action).toBe(
      "unchanged",
    );
  });

  it("re-registers a removed app and queues a new audit message", () => {
    const input = {
      name: "Example App",
      bundleId: "com.example.app",
      appAppleId: 123456789,
    };
    registerTrackedApp(database, input);
    removeTrackedApp(database, input.bundleId);
    const restored = registerTrackedApp(database, input);
    expect(restored).toMatchObject({
      action: "registered",
      app: { enabled: true },
    });
    expect(database.pendingTelegramOutboxCount()).toBe(3);
  });
});
