import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "./database";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("migrates legacy filtered rows to an explicit suppressed state", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ios-db-migration-"));
    directories.push(directory);
    const databasePath = path.join(directory, "legacy.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        bundle_id TEXT NOT NULL UNIQUE,
        app_apple_id INTEGER NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO apps VALUES (
        1, 'Example', 'com.example.app', 123456789, 1, 1000, 1000
      );

      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_uuid TEXT NOT NULL UNIQUE,
        app_id INTEGER REFERENCES apps(id) ON DELETE RESTRICT,
        notification_type TEXT NOT NULL,
        subtype TEXT,
        environment TEXT NOT NULL,
        signed_date INTEGER NOT NULL,
        transaction_id TEXT,
        original_transaction_id TEXT,
        product_id TEXT,
        message_html TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (delivery_status IN ('pending', 'sending', 'retry', 'delivered')),
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        locked_at INTEGER,
        last_error TEXT,
        telegram_message_id INTEGER,
        received_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX notifications_due_idx
        ON notifications(delivery_status, next_attempt_at);
      CREATE INDEX notifications_app_idx
        ON notifications(app_id, received_at DESC);
      CREATE INDEX notifications_transaction_idx
        ON notifications(transaction_id);
      INSERT INTO notifications VALUES (
        1, 'suppressed-event', 1, 'DID_FAIL_TO_RENEW', NULL, 'Production',
        1000, NULL, NULL, NULL, 'failed', '{}', 'delivered', 0, 1000,
        NULL, NULL, NULL, 1100, NULL
      );
      INSERT INTO notifications VALUES (
        2, 'delivered-event', 1, 'DID_RENEW', NULL, 'Production',
        1000, NULL, NULL, NULL, 'renewed', '{}', 'delivered', 1, 1000,
        NULL, NULL, 42, 1200, 1300
      );

      CREATE TABLE telegram_outbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deduplication_key TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        message_html TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (delivery_status IN ('pending', 'sending', 'retry', 'delivered')),
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL,
        locked_at INTEGER,
        last_error TEXT,
        telegram_message_id INTEGER,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER
      );
      CREATE INDEX telegram_outbox_due_idx
        ON telegram_outbox_messages(delivery_status, next_attempt_at);
      INSERT INTO telegram_outbox_messages VALUES (
        1, 'suppressed-outbox', 'other_event', 'other', 'delivered', 0,
        1000, NULL, NULL, NULL, 1400, NULL
      );

      PRAGMA user_version = 4;
    `);
    legacy.close();

    const migrated = new AppDatabase(databasePath);
    expect(migrated.getNotificationByUuid("suppressed-event")).toMatchObject({
      deliveryStatus: "suppressed",
      receivedAt: 1100,
      suppressedAt: 1100,
    });
    expect(migrated.getNotificationByUuid("delivered-event")).toMatchObject({
      deliveryStatus: "delivered",
      telegramMessageId: 42,
      deliveredAt: 1300,
      suppressedAt: undefined,
    });
    expect(
      migrated.getTelegramOutboxMessageByKey("suppressed-outbox"),
    ).toMatchObject({
      deliveryStatus: "suppressed",
      createdAt: 1400,
      suppressedAt: 1400,
    });
    expect(migrated.pendingCount()).toBe(0);
    expect(migrated.pendingTelegramOutboxCount()).toBe(0);
    migrated.close();

    const verified = new Database(databasePath, { readonly: true });
    expect(verified.pragma("user_version", { simple: true })).toBe(6);
    verified.close();
  });
});
