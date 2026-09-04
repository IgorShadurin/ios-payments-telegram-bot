import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getDatabasePath } from "./config";
import type {
  CustomerReviewBatchResult,
  CustomerReviewWithMessage,
  DailyAppMetrics,
  ExchangeRate,
  NewNotification,
  PortfolioReportKind,
  RegisteredApp,
  StoredCustomerReview,
  StoredCustomerReviewWithApp,
  StoredDailyReportDelivery,
  StoredMonthlyReportDelivery,
  StoredNotification,
  StoredPortfolioMetricSnapshot,
  StoredTelegramOutboxMessage,
  StoredWeeklyReportDelivery,
} from "./types";

interface AppRow {
  id: number;
  name: string;
  bundle_id: string;
  app_apple_id: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface NotificationRow {
  id: number;
  notification_uuid: string;
  app_id: number | null;
  app_name: string | null;
  notification_type: string;
  subtype: string | null;
  environment: string;
  signed_date: number;
  transaction_id: string | null;
  original_transaction_id: string | null;
  product_id: string | null;
  message_html: string;
  payload_json: string;
  delivery_status: StoredNotification["deliveryStatus"];
  delivery_attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  telegram_message_id: number | null;
  received_at: number;
  delivered_at: number | null;
  suppressed_at: number | null;
}

interface TelegramOutboxRow {
  id: number;
  deduplication_key: string;
  category: string;
  message_html: string;
  delivery_status: StoredTelegramOutboxMessage["deliveryStatus"];
  delivery_attempts: number;
  next_attempt_at: number;
  locked_at: number | null;
  last_error: string | null;
  telegram_message_id: number | null;
  created_at: number;
  delivered_at: number | null;
  suppressed_at: number | null;
}

interface CustomerReviewRow {
  review_id: string;
  app_id: number;
  rating: number;
  title: string;
  body: string;
  reviewer_nickname: string;
  territory: string;
  created_date: string;
  first_seen_at: number;
}

interface CustomerReviewWithAppRow extends CustomerReviewRow {
  app_name: string;
  bundle_id: string;
}

interface ExchangeRateRow {
  currency_code: string;
  units_per_usd: number;
  source_updated_at: number;
  next_update_at: number;
  fetched_at: number;
  provider: string;
}

interface DailyReportDeliveryRow {
  report_date: string;
  delivery_status: StoredDailyReportDelivery["deliveryStatus"];
  delivery_attempts: number;
  next_attempt_at: number;
  locked_at: number | null;
  image_path: string;
  last_error: string | null;
  telegram_message_id: number | null;
  created_at: number;
  delivered_at: number | null;
}

interface WeeklyReportDeliveryRow {
  week_start_date: string;
  week_end_date: string;
  delivery_status: StoredWeeklyReportDelivery["deliveryStatus"];
  delivery_attempts: number;
  next_attempt_at: number;
  locked_at: number | null;
  image_path: string;
  last_error: string | null;
  telegram_message_id: number | null;
  created_at: number;
  delivered_at: number | null;
}

interface MonthlyReportDeliveryRow {
  month_start_date: string;
  month_end_date: string;
  delivery_status: StoredMonthlyReportDelivery["deliveryStatus"];
  delivery_attempts: number;
  next_attempt_at: number;
  locked_at: number | null;
  image_path: string;
  last_error: string | null;
  telegram_message_id: number | null;
  created_at: number;
  delivered_at: number | null;
}

interface PortfolioMetricSnapshotRow {
  report_kind: PortfolioReportKind;
  period_start_date: string;
  period_end_date: string;
  app_apple_id: number;
  app_name: string;
  bundle_id: string;
  first_release_date: string | null;
  impressions: number | null;
  downloads: number | null;
  proceeds_usd: number | null;
  impressions_availability: StoredPortfolioMetricSnapshot["impressionsAvailability"];
  downloads_availability: StoredPortfolioMetricSnapshot["downloadsAvailability"];
  proceeds_availability: StoredPortfolioMetricSnapshot["proceedsAvailability"];
  collected_at: number;
}

function mapApp(row: AppRow): RegisteredApp {
  return {
    id: row.id,
    name: row.name,
    bundleId: row.bundle_id,
    appAppleId: row.app_apple_id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNotification(row: NotificationRow): StoredNotification {
  return {
    id: row.id,
    notificationUuid: row.notification_uuid,
    appId: row.app_id ?? undefined,
    appName: row.app_name ?? undefined,
    notificationType: row.notification_type,
    subtype: row.subtype ?? undefined,
    environment: row.environment,
    signedDate: row.signed_date,
    transactionId: row.transaction_id ?? undefined,
    originalTransactionId: row.original_transaction_id ?? undefined,
    productId: row.product_id ?? undefined,
    messageHtml: row.message_html,
    payloadJson: row.payload_json,
    deliveryStatus: row.delivery_status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    telegramMessageId: row.telegram_message_id ?? undefined,
    receivedAt: row.received_at,
    deliveredAt: row.delivered_at ?? undefined,
    suppressedAt: row.suppressed_at ?? undefined,
  };
}

function mapTelegramOutboxMessage(
  row: TelegramOutboxRow,
): StoredTelegramOutboxMessage {
  return {
    id: row.id,
    deduplicationKey: row.deduplication_key,
    category: row.category,
    messageHtml: row.message_html,
    deliveryStatus: row.delivery_status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error ?? undefined,
    telegramMessageId: row.telegram_message_id ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
    suppressedAt: row.suppressed_at ?? undefined,
  };
}

function mapCustomerReview(row: CustomerReviewRow): StoredCustomerReview {
  return {
    id: row.review_id,
    appId: row.app_id,
    rating: row.rating,
    title: row.title,
    body: row.body,
    reviewerNickname: row.reviewer_nickname,
    territory: row.territory,
    createdDate: row.created_date,
    firstSeenAt: row.first_seen_at,
  };
}

function mapCustomerReviewWithApp(
  row: CustomerReviewWithAppRow,
): StoredCustomerReviewWithApp {
  return {
    ...mapCustomerReview(row),
    appName: row.app_name,
    bundleId: row.bundle_id,
  };
}

function mapExchangeRate(row: ExchangeRateRow): ExchangeRate {
  return {
    currencyCode: row.currency_code,
    unitsPerUsd: row.units_per_usd,
    sourceUpdatedAt: row.source_updated_at,
    nextUpdateAt: row.next_update_at,
    fetchedAt: row.fetched_at,
    provider: row.provider,
  };
}

function mapDailyReportDelivery(
  row: DailyReportDeliveryRow,
): StoredDailyReportDelivery {
  return {
    reportDate: row.report_date,
    deliveryStatus: row.delivery_status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    imagePath: row.image_path,
    lastError: row.last_error ?? undefined,
    telegramMessageId: row.telegram_message_id ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
  };
}

function mapWeeklyReportDelivery(
  row: WeeklyReportDeliveryRow,
): StoredWeeklyReportDelivery {
  return {
    weekStartDate: row.week_start_date,
    weekEndDate: row.week_end_date,
    deliveryStatus: row.delivery_status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    imagePath: row.image_path,
    lastError: row.last_error ?? undefined,
    telegramMessageId: row.telegram_message_id ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
  };
}

function mapMonthlyReportDelivery(
  row: MonthlyReportDeliveryRow,
): StoredMonthlyReportDelivery {
  return {
    monthStartDate: row.month_start_date,
    monthEndDate: row.month_end_date,
    deliveryStatus: row.delivery_status,
    deliveryAttempts: row.delivery_attempts,
    nextAttemptAt: row.next_attempt_at,
    imagePath: row.image_path,
    lastError: row.last_error ?? undefined,
    telegramMessageId: row.telegram_message_id ?? undefined,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
  };
}

function mapPortfolioMetricSnapshot(
  row: PortfolioMetricSnapshotRow,
): StoredPortfolioMetricSnapshot {
  return {
    reportKind: row.report_kind,
    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,
    appAppleId: row.app_apple_id,
    name: row.app_name,
    bundleId: row.bundle_id,
    firstReleaseDate: row.first_release_date ?? undefined,
    impressions: row.impressions ?? undefined,
    downloads: row.downloads ?? undefined,
    proceedsUsd: row.proceeds_usd ?? undefined,
    impressionsAvailability: row.impressions_availability,
    downloadsAvailability: row.downloads_availability,
    proceedsAvailability: row.proceeds_availability,
    collectedAt: row.collected_at,
  };
}

export class AppDatabase {
  private readonly database: Database.Database;

  constructor(databasePath = getDatabasePath()) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o750 });
    this.database = new Database(databasePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    let version = this.database.pragma("user_version", {
      simple: true,
    }) as number;

    if (version > 10) {
      throw new Error(
        `Database schema ${version} is newer than this application supports`,
      );
    }

    if (version === 0) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE apps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            bundle_id TEXT NOT NULL UNIQUE,
            app_apple_id INTEGER NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
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

          PRAGMA user_version = 1;
        `);
      })();
      version = 1;
    }

    if (version === 1) {
      this.database.transaction(() => {
        this.database.exec(`
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

          PRAGMA user_version = 2;
        `);
      })();
      version = 2;
    }

    if (version === 2) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE customer_reviews (
            review_id TEXT PRIMARY KEY,
            app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            reviewer_nickname TEXT NOT NULL,
            territory TEXT NOT NULL,
            created_date TEXT NOT NULL,
            first_seen_at INTEGER NOT NULL
          );

          CREATE INDEX customer_reviews_app_date_idx
            ON customer_reviews(app_id, created_date DESC);

          CREATE TABLE customer_review_poll_state (
            app_id INTEGER PRIMARY KEY REFERENCES apps(id) ON DELETE RESTRICT,
            initialized_at INTEGER NOT NULL,
            last_polled_at INTEGER NOT NULL
          );

          PRAGMA user_version = 3;
        `);
      })();
      version = 3;
    }

    if (version === 3) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE exchange_rates (
            currency_code TEXT PRIMARY KEY
              CHECK (length(currency_code) = 3),
            units_per_usd REAL NOT NULL CHECK (units_per_usd > 0),
            source_updated_at INTEGER NOT NULL,
            next_update_at INTEGER NOT NULL,
            fetched_at INTEGER NOT NULL,
            provider TEXT NOT NULL
          );

          PRAGMA user_version = 4;
        `);
      })();
      version = 4;
    }

    if (version === 4) {
      this.database.transaction(() => {
        this.database.exec(`
          DROP INDEX notifications_due_idx;
          DROP INDEX notifications_app_idx;
          DROP INDEX notifications_transaction_idx;
          ALTER TABLE notifications RENAME TO notifications_v4;

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
              CHECK (delivery_status IN (
                'pending', 'sending', 'retry', 'delivered', 'suppressed'
              )),
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL,
            locked_at INTEGER,
            last_error TEXT,
            telegram_message_id INTEGER,
            received_at INTEGER NOT NULL,
            delivered_at INTEGER,
            suppressed_at INTEGER
          );

          INSERT INTO notifications (
            id, notification_uuid, app_id, notification_type, subtype,
            environment, signed_date, transaction_id,
            original_transaction_id, product_id, message_html, payload_json,
            delivery_status, delivery_attempts, next_attempt_at, locked_at,
            last_error, telegram_message_id, received_at, delivered_at,
            suppressed_at
          )
          SELECT
            id, notification_uuid, app_id, notification_type, subtype,
            environment, signed_date, transaction_id,
            original_transaction_id, product_id, message_html, payload_json,
            CASE
              WHEN delivery_status = 'delivered'
                AND telegram_message_id IS NULL
                AND delivery_attempts = 0
                AND delivered_at IS NULL
              THEN 'suppressed'
              ELSE delivery_status
            END,
            delivery_attempts, next_attempt_at, locked_at, last_error,
            telegram_message_id, received_at, delivered_at,
            CASE
              WHEN delivery_status = 'delivered'
                AND telegram_message_id IS NULL
                AND delivery_attempts = 0
                AND delivered_at IS NULL
              THEN received_at
              ELSE NULL
            END
          FROM notifications_v4;

          DROP TABLE notifications_v4;
          CREATE INDEX notifications_due_idx
            ON notifications(delivery_status, next_attempt_at);
          CREATE INDEX notifications_app_idx
            ON notifications(app_id, received_at DESC);
          CREATE INDEX notifications_transaction_idx
            ON notifications(transaction_id);

          DROP INDEX telegram_outbox_due_idx;
          ALTER TABLE telegram_outbox_messages
            RENAME TO telegram_outbox_messages_v4;

          CREATE TABLE telegram_outbox_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deduplication_key TEXT NOT NULL UNIQUE,
            category TEXT NOT NULL,
            message_html TEXT NOT NULL,
            delivery_status TEXT NOT NULL DEFAULT 'pending'
              CHECK (delivery_status IN (
                'pending', 'sending', 'retry', 'delivered', 'suppressed'
              )),
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL,
            locked_at INTEGER,
            last_error TEXT,
            telegram_message_id INTEGER,
            created_at INTEGER NOT NULL,
            delivered_at INTEGER,
            suppressed_at INTEGER
          );

          INSERT INTO telegram_outbox_messages (
            id, deduplication_key, category, message_html, delivery_status,
            delivery_attempts, next_attempt_at, locked_at, last_error,
            telegram_message_id, created_at, delivered_at, suppressed_at
          )
          SELECT
            id, deduplication_key, category, message_html,
            CASE
              WHEN delivery_status = 'delivered'
                AND telegram_message_id IS NULL
                AND delivery_attempts = 0
                AND delivered_at IS NULL
              THEN 'suppressed'
              ELSE delivery_status
            END,
            delivery_attempts, next_attempt_at, locked_at, last_error,
            telegram_message_id, created_at, delivered_at,
            CASE
              WHEN delivery_status = 'delivered'
                AND telegram_message_id IS NULL
                AND delivery_attempts = 0
                AND delivered_at IS NULL
              THEN created_at
              ELSE NULL
            END
          FROM telegram_outbox_messages_v4;

          DROP TABLE telegram_outbox_messages_v4;
          CREATE INDEX telegram_outbox_due_idx
            ON telegram_outbox_messages(delivery_status, next_attempt_at);

          PRAGMA user_version = 5;
        `);
      })();
      version = 5;
    }

    if (version === 5) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE daily_report_deliveries (
            report_date TEXT PRIMARY KEY
              CHECK (report_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            delivery_status TEXT NOT NULL DEFAULT 'pending'
              CHECK (delivery_status IN ('pending', 'sending', 'retry', 'delivered')),
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL,
            locked_at INTEGER,
            image_path TEXT NOT NULL,
            last_error TEXT,
            telegram_message_id INTEGER,
            created_at INTEGER NOT NULL,
            delivered_at INTEGER
          );

          CREATE INDEX daily_report_deliveries_due_idx
            ON daily_report_deliveries(delivery_status, next_attempt_at);

          PRAGMA user_version = 6;
        `);
      })();
      version = 6;
    }

    if (version === 6) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE weekly_report_deliveries (
            week_start_date TEXT PRIMARY KEY
              CHECK (week_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            week_end_date TEXT NOT NULL
              CHECK (week_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            delivery_status TEXT NOT NULL DEFAULT 'pending'
              CHECK (delivery_status IN ('pending', 'sending', 'retry', 'delivered')),
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL,
            locked_at INTEGER,
            image_path TEXT NOT NULL,
            last_error TEXT,
            telegram_message_id INTEGER,
            created_at INTEGER NOT NULL,
            delivered_at INTEGER
          );

          CREATE INDEX weekly_report_deliveries_due_idx
            ON weekly_report_deliveries(delivery_status, next_attempt_at);

          PRAGMA user_version = 7;
        `);
      })();
      version = 7;
    }

    if (version === 7) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE portfolio_metric_snapshots (
            report_kind TEXT NOT NULL
              CHECK (report_kind IN ('daily', 'weekly')),
            period_start_date TEXT NOT NULL
              CHECK (period_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            period_end_date TEXT NOT NULL
              CHECK (period_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            app_apple_id INTEGER NOT NULL,
            app_name TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            impressions INTEGER,
            downloads INTEGER,
            proceeds_usd REAL,
            impressions_availability TEXT NOT NULL
              CHECK (impressions_availability IN ('available', 'pending')),
            downloads_availability TEXT NOT NULL
              CHECK (downloads_availability IN ('available', 'pending')),
            proceeds_availability TEXT NOT NULL
              CHECK (proceeds_availability IN ('available', 'pending')),
            collected_at INTEGER NOT NULL,
            PRIMARY KEY (report_kind, period_start_date, app_apple_id)
          );

          CREATE INDEX portfolio_metric_snapshots_period_idx
            ON portfolio_metric_snapshots(
              report_kind, period_start_date, period_end_date
            );

          PRAGMA user_version = 8;
        `);
      })();
      version = 8;
    }

    if (version === 8) {
      this.database.transaction(() => {
        this.database.exec(`
          ALTER TABLE portfolio_metric_snapshots
            ADD COLUMN first_release_date TEXT;

          PRAGMA user_version = 9;
        `);
      })();
      version = 9;
    }

    if (version === 9) {
      this.database.transaction(() => {
        this.database.exec(`
          CREATE TABLE monthly_report_deliveries (
            month_start_date TEXT PRIMARY KEY
              CHECK (month_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-01'),
            month_end_date TEXT NOT NULL
              CHECK (month_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            delivery_status TEXT NOT NULL DEFAULT 'pending'
              CHECK (delivery_status IN ('pending', 'sending', 'retry', 'delivered')),
            delivery_attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL,
            locked_at INTEGER,
            image_path TEXT NOT NULL,
            last_error TEXT,
            telegram_message_id INTEGER,
            created_at INTEGER NOT NULL,
            delivered_at INTEGER
          );

          CREATE INDEX monthly_report_deliveries_due_idx
            ON monthly_report_deliveries(delivery_status, next_attempt_at);

          DROP INDEX portfolio_metric_snapshots_period_idx;
          ALTER TABLE portfolio_metric_snapshots
            RENAME TO portfolio_metric_snapshots_v9;

          CREATE TABLE portfolio_metric_snapshots (
            report_kind TEXT NOT NULL
              CHECK (report_kind IN ('daily', 'weekly', 'monthly')),
            period_start_date TEXT NOT NULL
              CHECK (period_start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            period_end_date TEXT NOT NULL
              CHECK (period_end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
            app_apple_id INTEGER NOT NULL,
            app_name TEXT NOT NULL,
            bundle_id TEXT NOT NULL,
            impressions INTEGER,
            downloads INTEGER,
            proceeds_usd REAL,
            impressions_availability TEXT NOT NULL
              CHECK (impressions_availability IN ('available', 'pending')),
            downloads_availability TEXT NOT NULL
              CHECK (downloads_availability IN ('available', 'pending')),
            proceeds_availability TEXT NOT NULL
              CHECK (proceeds_availability IN ('available', 'pending')),
            collected_at INTEGER NOT NULL,
            first_release_date TEXT,
            PRIMARY KEY (report_kind, period_start_date, app_apple_id)
          );

          INSERT INTO portfolio_metric_snapshots (
            report_kind, period_start_date, period_end_date, app_apple_id,
            app_name, bundle_id, impressions, downloads, proceeds_usd,
            impressions_availability, downloads_availability,
            proceeds_availability, collected_at, first_release_date
          )
          SELECT
            report_kind, period_start_date, period_end_date, app_apple_id,
            app_name, bundle_id, impressions, downloads, proceeds_usd,
            impressions_availability, downloads_availability,
            proceeds_availability, collected_at, first_release_date
          FROM portfolio_metric_snapshots_v9;

          DROP TABLE portfolio_metric_snapshots_v9;
          CREATE INDEX portfolio_metric_snapshots_period_idx
            ON portfolio_metric_snapshots(
              report_kind, period_start_date, period_end_date
            );

          PRAGMA user_version = 10;
        `);
      })();
    }
  }

  close(): void {
    this.database.close();
  }

  healthCheck(): void {
    this.database.prepare("SELECT 1").get();
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  addApp(name: string, bundleId: string, appAppleId: number): RegisteredApp {
    const now = Date.now();
    const result = this.database
      .prepare(
        `INSERT INTO apps (name, bundle_id, app_apple_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .run(name, bundleId, appAppleId, now, now);
    const app = this.getAppById(Number(result.lastInsertRowid));
    if (!app) {
      throw new Error("App insert did not produce a database record");
    }
    return app;
  }

  updateApp(
    bundleId: string,
    changes: { name?: string; appAppleId?: number },
  ): RegisteredApp | undefined {
    const current = this.getAppByBundleId(bundleId, true);
    if (!current) {
      return undefined;
    }

    this.database
      .prepare(
        `UPDATE apps
         SET name = ?, app_apple_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        changes.name ?? current.name,
        changes.appAppleId ?? current.appAppleId,
        Date.now(),
        current.id,
      );
    return this.getAppById(current.id);
  }

  setAppEnabled(bundleId: string, enabled: boolean): RegisteredApp | undefined {
    const result = this.database
      .prepare(
        "UPDATE apps SET enabled = ?, updated_at = ? WHERE bundle_id = ?",
      )
      .run(enabled ? 1 : 0, Date.now(), bundleId);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getAppByBundleId(bundleId, true);
  }

  getAppById(id: number): RegisteredApp | undefined {
    const row = this.database
      .prepare("SELECT * FROM apps WHERE id = ?")
      .get(id) as AppRow | undefined;
    return row ? mapApp(row) : undefined;
  }

  getAppByBundleId(
    bundleId: string,
    includeDisabled = false,
  ): RegisteredApp | undefined {
    const row = this.database
      .prepare(
        `SELECT * FROM apps
         WHERE bundle_id = ? ${includeDisabled ? "" : "AND enabled = 1"}`,
      )
      .get(bundleId) as AppRow | undefined;
    return row ? mapApp(row) : undefined;
  }

  listApps(includeDisabled = true): RegisteredApp[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM apps
         ${includeDisabled ? "" : "WHERE enabled = 1"}
         ORDER BY name COLLATE NOCASE, bundle_id`,
      )
      .all() as AppRow[];
    return rows.map(mapApp);
  }

  appCount(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM apps WHERE enabled = 1")
      .get() as { count: number };
    return row.count;
  }

  getDailyReportDelivery(
    reportDate: string,
  ): StoredDailyReportDelivery | undefined {
    const row = this.database
      .prepare("SELECT * FROM daily_report_deliveries WHERE report_date = ?")
      .get(reportDate) as DailyReportDeliveryRow | undefined;
    return row ? mapDailyReportDelivery(row) : undefined;
  }

  claimDailyReportDelivery(
    reportDate: string,
    imagePath: string,
    forceRedelivery = false,
  ): StoredDailyReportDelivery | undefined {
    const now = Date.now();
    const staleLock = now - 90 * 60 * 1_000;
    return this.database.transaction(() => {
      if (forceRedelivery) {
        this.database
          .prepare(
            `UPDATE daily_report_deliveries
             SET delivery_status = 'pending', next_attempt_at = ?,
                 locked_at = NULL, last_error = NULL,
                 telegram_message_id = NULL, delivered_at = NULL
             WHERE report_date = ? AND delivery_status = 'delivered'`,
          )
          .run(now, reportDate);
      }
      this.database
        .prepare(
          `INSERT INTO daily_report_deliveries (
            report_date, delivery_status, next_attempt_at, image_path, created_at
          ) VALUES (?, 'pending', ?, ?, ?)
          ON CONFLICT(report_date) DO NOTHING`,
        )
        .run(reportDate, now, imagePath, now);
      const result = this.database
        .prepare(
          `UPDATE daily_report_deliveries
           SET delivery_status = 'sending', locked_at = ?, image_path = ?
           WHERE report_date = ?
             AND (
               (delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?)
               OR (delivery_status = 'sending' AND locked_at < ?)
             )`,
        )
        .run(now, imagePath, reportDate, now, staleLock);
      return result.changes === 1
        ? this.getDailyReportDelivery(reportDate)
        : undefined;
    })();
  }

  markDailyReportDelivered(
    reportDate: string,
    telegramMessageId: number,
  ): void {
    this.database
      .prepare(
        `UPDATE daily_report_deliveries
         SET delivery_status = 'delivered',
             delivery_attempts = delivery_attempts + 1,
             telegram_message_id = ?, delivered_at = ?, locked_at = NULL,
             last_error = NULL
         WHERE report_date = ? AND delivery_status = 'sending'`,
      )
      .run(telegramMessageId, Date.now(), reportDate);
  }

  markDailyReportForRetry(
    reportDate: string,
    error: string,
    nextAttemptAt: number,
  ): void {
    this.database
      .prepare(
        `UPDATE daily_report_deliveries
         SET delivery_status = 'retry',
             delivery_attempts = delivery_attempts + 1,
             next_attempt_at = ?, locked_at = NULL, last_error = ?
         WHERE report_date = ? AND delivery_status = 'sending'`,
      )
      .run(nextAttemptAt, error.slice(0, 500), reportDate);
  }

  getWeeklyReportDelivery(
    weekStartDate: string,
  ): StoredWeeklyReportDelivery | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM weekly_report_deliveries WHERE week_start_date = ?",
      )
      .get(weekStartDate) as WeeklyReportDeliveryRow | undefined;
    return row ? mapWeeklyReportDelivery(row) : undefined;
  }

  claimWeeklyReportDelivery(
    weekStartDate: string,
    weekEndDate: string,
    imagePath: string,
    forceRedelivery = false,
  ): StoredWeeklyReportDelivery | undefined {
    const now = Date.now();
    const staleLock = now - 90 * 60 * 1_000;
    return this.database.transaction(() => {
      if (forceRedelivery) {
        this.database
          .prepare(
            `UPDATE weekly_report_deliveries
             SET delivery_status = 'pending', next_attempt_at = ?,
                 locked_at = NULL, last_error = NULL,
                 telegram_message_id = NULL, delivered_at = NULL
             WHERE week_start_date = ? AND delivery_status = 'delivered'`,
          )
          .run(now, weekStartDate);
      }
      this.database
        .prepare(
          `INSERT INTO weekly_report_deliveries (
            week_start_date, week_end_date, delivery_status, next_attempt_at,
            image_path, created_at
          ) VALUES (?, ?, 'pending', ?, ?, ?)
          ON CONFLICT(week_start_date) DO NOTHING`,
        )
        .run(weekStartDate, weekEndDate, now, imagePath, now);
      const result = this.database
        .prepare(
          `UPDATE weekly_report_deliveries
           SET delivery_status = 'sending', locked_at = ?, image_path = ?
           WHERE week_start_date = ? AND week_end_date = ?
             AND (
               (delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?)
               OR (delivery_status = 'sending' AND locked_at < ?)
             )`,
        )
        .run(now, imagePath, weekStartDate, weekEndDate, now, staleLock);
      return result.changes === 1
        ? this.getWeeklyReportDelivery(weekStartDate)
        : undefined;
    })();
  }

  markWeeklyReportDelivered(
    weekStartDate: string,
    telegramMessageId: number,
  ): void {
    this.database
      .prepare(
        `UPDATE weekly_report_deliveries
         SET delivery_status = 'delivered',
             delivery_attempts = delivery_attempts + 1,
             telegram_message_id = ?, delivered_at = ?, locked_at = NULL,
             last_error = NULL
         WHERE week_start_date = ? AND delivery_status = 'sending'`,
      )
      .run(telegramMessageId, Date.now(), weekStartDate);
  }

  markWeeklyReportForRetry(
    weekStartDate: string,
    error: string,
    nextAttemptAt: number,
  ): void {
    this.database
      .prepare(
        `UPDATE weekly_report_deliveries
         SET delivery_status = 'retry',
             delivery_attempts = delivery_attempts + 1,
             next_attempt_at = ?, locked_at = NULL, last_error = ?
         WHERE week_start_date = ? AND delivery_status = 'sending'`,
      )
      .run(nextAttemptAt, error.slice(0, 500), weekStartDate);
  }

  getMonthlyReportDelivery(
    monthStartDate: string,
  ): StoredMonthlyReportDelivery | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM monthly_report_deliveries WHERE month_start_date = ?",
      )
      .get(monthStartDate) as MonthlyReportDeliveryRow | undefined;
    return row ? mapMonthlyReportDelivery(row) : undefined;
  }

  claimMonthlyReportDelivery(
    monthStartDate: string,
    monthEndDate: string,
    imagePath: string,
    forceRedelivery = false,
  ): StoredMonthlyReportDelivery | undefined {
    const now = Date.now();
    const staleLock = now - 90 * 60 * 1_000;
    return this.database.transaction(() => {
      if (forceRedelivery) {
        this.database
          .prepare(
            `UPDATE monthly_report_deliveries
             SET delivery_status = 'pending', next_attempt_at = ?,
                 locked_at = NULL, last_error = NULL,
                 telegram_message_id = NULL, delivered_at = NULL
             WHERE month_start_date = ? AND delivery_status = 'delivered'`,
          )
          .run(now, monthStartDate);
      }
      this.database
        .prepare(
          `INSERT INTO monthly_report_deliveries (
            month_start_date, month_end_date, delivery_status,
            next_attempt_at, image_path, created_at
          ) VALUES (?, ?, 'pending', ?, ?, ?)
          ON CONFLICT(month_start_date) DO NOTHING`,
        )
        .run(monthStartDate, monthEndDate, now, imagePath, now);
      const result = this.database
        .prepare(
          `UPDATE monthly_report_deliveries
           SET delivery_status = 'sending', locked_at = ?, image_path = ?
           WHERE month_start_date = ? AND month_end_date = ?
             AND (
               (delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?)
               OR (delivery_status = 'sending' AND locked_at < ?)
             )`,
        )
        .run(now, imagePath, monthStartDate, monthEndDate, now, staleLock);
      return result.changes === 1
        ? this.getMonthlyReportDelivery(monthStartDate)
        : undefined;
    })();
  }

  markMonthlyReportDelivered(
    monthStartDate: string,
    telegramMessageId: number,
  ): void {
    this.database
      .prepare(
        `UPDATE monthly_report_deliveries
         SET delivery_status = 'delivered',
             delivery_attempts = delivery_attempts + 1,
             telegram_message_id = ?, delivered_at = ?, locked_at = NULL,
             last_error = NULL
         WHERE month_start_date = ? AND delivery_status = 'sending'`,
      )
      .run(telegramMessageId, Date.now(), monthStartDate);
  }

  markMonthlyReportForRetry(
    monthStartDate: string,
    error: string,
    nextAttemptAt: number,
  ): void {
    this.database
      .prepare(
        `UPDATE monthly_report_deliveries
         SET delivery_status = 'retry',
             delivery_attempts = delivery_attempts + 1,
             next_attempt_at = ?, locked_at = NULL, last_error = ?
         WHERE month_start_date = ? AND delivery_status = 'sending'`,
      )
      .run(nextAttemptAt, error.slice(0, 500), monthStartDate);
  }

  storePortfolioMetrics(
    reportKind: PortfolioReportKind,
    periodStartDate: string,
    periodEndDate: string,
    apps: readonly DailyAppMetrics[],
    collectedAt = Date.now(),
  ): void {
    const upsert = this.database.prepare(
      `INSERT INTO portfolio_metric_snapshots (
        report_kind, period_start_date, period_end_date, app_apple_id,
        app_name, bundle_id, first_release_date, impressions, downloads,
        proceeds_usd,
        impressions_availability, downloads_availability,
        proceeds_availability, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_kind, period_start_date, app_apple_id) DO UPDATE SET
        period_end_date = excluded.period_end_date,
        app_name = excluded.app_name,
        bundle_id = excluded.bundle_id,
        first_release_date = COALESCE(
          excluded.first_release_date,
          portfolio_metric_snapshots.first_release_date
        ),
        impressions = COALESCE(
          excluded.impressions,
          portfolio_metric_snapshots.impressions
        ),
        downloads = COALESCE(
          excluded.downloads,
          portfolio_metric_snapshots.downloads
        ),
        proceeds_usd = COALESCE(
          excluded.proceeds_usd,
          portfolio_metric_snapshots.proceeds_usd
        ),
        impressions_availability = CASE
          WHEN excluded.impressions IS NULL
            AND portfolio_metric_snapshots.impressions IS NOT NULL
          THEN portfolio_metric_snapshots.impressions_availability
          ELSE excluded.impressions_availability
        END,
        downloads_availability = CASE
          WHEN excluded.downloads IS NULL
            AND portfolio_metric_snapshots.downloads IS NOT NULL
          THEN portfolio_metric_snapshots.downloads_availability
          ELSE excluded.downloads_availability
        END,
        proceeds_availability = CASE
          WHEN excluded.proceeds_usd IS NULL
            AND portfolio_metric_snapshots.proceeds_usd IS NOT NULL
          THEN portfolio_metric_snapshots.proceeds_availability
          ELSE excluded.proceeds_availability
        END,
        collected_at = excluded.collected_at`,
    );
    this.database.transaction(() => {
      for (const app of apps) {
        upsert.run(
          reportKind,
          periodStartDate,
          periodEndDate,
          app.appAppleId,
          app.name,
          app.bundleId,
          app.firstReleaseDate ?? null,
          app.impressions ?? null,
          app.downloads ?? null,
          app.proceedsUsd ?? null,
          app.impressionsAvailability,
          app.downloadsAvailability,
          app.proceedsAvailability,
          collectedAt,
        );
      }
    })();
  }

  getPortfolioMetrics(
    reportKind: PortfolioReportKind,
    periodStartDate: string,
  ): StoredPortfolioMetricSnapshot[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM portfolio_metric_snapshots
         WHERE report_kind = ? AND period_start_date = ?
         ORDER BY app_name COLLATE NOCASE, app_apple_id`,
      )
      .all(reportKind, periodStartDate) as PortfolioMetricSnapshotRow[];
    return rows.map(mapPortfolioMetricSnapshot);
  }

  enqueueTelegramMessage(
    deduplicationKey: string,
    category: string,
    messageHtml: string,
  ): {
    created: boolean;
    message: StoredTelegramOutboxMessage;
  } {
    const now = Date.now();
    const result = this.database
      .prepare(
        `INSERT INTO telegram_outbox_messages (
          deduplication_key, category, message_html, delivery_status,
          next_attempt_at, created_at
        ) VALUES (?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(deduplication_key) DO NOTHING`,
      )
      .run(deduplicationKey, category, messageHtml, now, now);
    const message = this.getTelegramOutboxMessageByKey(deduplicationKey);
    if (!message) {
      throw new Error("Telegram outbox insert did not produce a record");
    }
    return { created: result.changes === 1, message };
  }

  getTelegramOutboxMessageByKey(
    deduplicationKey: string,
  ): StoredTelegramOutboxMessage | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM telegram_outbox_messages WHERE deduplication_key = ?",
      )
      .get(deduplicationKey) as TelegramOutboxRow | undefined;
    return row ? mapTelegramOutboxMessage(row) : undefined;
  }

  getTelegramOutboxMessageById(
    id: number,
  ): StoredTelegramOutboxMessage | undefined {
    const row = this.database
      .prepare("SELECT * FROM telegram_outbox_messages WHERE id = ?")
      .get(id) as TelegramOutboxRow | undefined;
    return row ? mapTelegramOutboxMessage(row) : undefined;
  }

  claimTelegramOutboxMessage(
    id: number,
  ): StoredTelegramOutboxMessage | undefined {
    const now = Date.now();
    const staleLock = now - 10 * 60 * 1000;
    const result = this.database
      .prepare(
        `UPDATE telegram_outbox_messages
         SET delivery_status = 'sending', locked_at = ?
         WHERE id = ?
           AND (
             (delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?)
             OR (delivery_status = 'sending' AND locked_at < ?)
           )`,
      )
      .run(now, id, now, staleLock);
    return result.changes === 1
      ? this.getTelegramOutboxMessageById(id)
      : undefined;
  }

  claimDueTelegramOutboxMessages(limit: number): StoredTelegramOutboxMessage[] {
    const now = Date.now();
    const staleLock = now - 10 * 60 * 1000;
    return this.database.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT id FROM telegram_outbox_messages
           WHERE (
             delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?
           ) OR (
             delivery_status = 'sending' AND locked_at < ?
           )
           ORDER BY next_attempt_at, id
           LIMIT ?`,
        )
        .all(now, staleLock, limit) as Array<{ id: number }>;

      const claimed: StoredTelegramOutboxMessage[] = [];
      for (const row of rows) {
        const message = this.claimTelegramOutboxMessage(row.id);
        if (message) {
          claimed.push(message);
        }
      }
      return claimed;
    })();
  }

  markTelegramOutboxDelivered(id: number, telegramMessageId: number): void {
    this.database
      .prepare(
        `UPDATE telegram_outbox_messages
         SET delivery_status = 'delivered',
             delivery_attempts = delivery_attempts + 1,
             telegram_message_id = ?,
             delivered_at = ?,
             locked_at = NULL,
             last_error = NULL
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(telegramMessageId, Date.now(), id);
  }

  markTelegramOutboxSuppressed(id: number): void {
    this.database
      .prepare(
        `UPDATE telegram_outbox_messages
         SET delivery_status = 'suppressed',
             suppressed_at = ?,
             locked_at = NULL,
             last_error = NULL
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(Date.now(), id);
  }

  markTelegramOutboxForRetry(
    id: number,
    error: string,
    nextAttemptAt: number,
  ): void {
    this.database
      .prepare(
        `UPDATE telegram_outbox_messages
         SET delivery_status = 'retry',
             delivery_attempts = delivery_attempts + 1,
             next_attempt_at = ?,
             locked_at = NULL,
             last_error = ?
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(nextAttemptAt, error.slice(0, 500), id);
  }

  pendingTelegramOutboxCount(): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM telegram_outbox_messages
         WHERE delivery_status IN ('pending', 'sending', 'retry')`,
      )
      .get() as { count: number };
    return row.count;
  }

  storeCustomerReviewBatch(
    appId: number,
    reviews: readonly CustomerReviewWithMessage[],
  ): CustomerReviewBatchResult {
    return this.database.transaction(() => {
      const now = Date.now();
      const stateInsert = this.database
        .prepare(
          `INSERT INTO customer_review_poll_state (
            app_id, initialized_at, last_polled_at
          ) VALUES (?, ?, ?)
          ON CONFLICT(app_id) DO NOTHING`,
        )
        .run(appId, now, now);
      const baselineCreated = stateInsert.changes === 1;

      if (!baselineCreated) {
        this.database
          .prepare(
            "UPDATE customer_review_poll_state SET last_polled_at = ? WHERE app_id = ?",
          )
          .run(now, appId);
      }

      const insertReview = this.database.prepare(
        `INSERT INTO customer_reviews (
          review_id, app_id, rating, title, body, reviewer_nickname,
          territory, created_date, first_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(review_id) DO NOTHING`,
      );
      const insertOutbox = this.database.prepare(
        `INSERT INTO telegram_outbox_messages (
          deduplication_key, category, message_html, delivery_status,
          next_attempt_at, created_at
        ) VALUES (?, 'app_review', ?, 'pending', ?, ?)
        ON CONFLICT(deduplication_key) DO NOTHING`,
      );

      let stored = 0;
      let queued = 0;
      for (const review of reviews) {
        const result = insertReview.run(
          review.id,
          appId,
          review.rating,
          review.title,
          review.body,
          review.reviewerNickname,
          review.territory,
          review.createdDate,
          now,
        );
        if (result.changes !== 1) {
          continue;
        }
        stored += 1;
        if (!baselineCreated) {
          queued += insertOutbox.run(
            `app-review:${review.id}`,
            review.messageHtml,
            now,
            now,
          ).changes;
        }
      }

      return { baselineCreated, stored, queued };
    })();
  }

  getCustomerReview(reviewId: string): StoredCustomerReview | undefined {
    const row = this.database
      .prepare("SELECT * FROM customer_reviews WHERE review_id = ?")
      .get(reviewId) as CustomerReviewRow | undefined;
    return row ? mapCustomerReview(row) : undefined;
  }

  customerReviewCount(appId?: number): number {
    const row =
      appId === undefined
        ? (this.database
            .prepare("SELECT COUNT(*) AS count FROM customer_reviews")
            .get() as { count: number })
        : (this.database
            .prepare(
              "SELECT COUNT(*) AS count FROM customer_reviews WHERE app_id = ?",
            )
            .get(appId) as { count: number });
    return row.count;
  }

  listCustomerReviews(limit = 50): StoredCustomerReviewWithApp[] {
    const rows = this.database
      .prepare(
        `SELECT
          customer_reviews.*,
          apps.name AS app_name,
          apps.bundle_id
        FROM customer_reviews
        INNER JOIN apps ON apps.id = customer_reviews.app_id
        ORDER BY customer_reviews.created_date DESC,
                 customer_reviews.first_seen_at DESC,
                 customer_reviews.review_id
        LIMIT ?`,
      )
      .all(limit) as CustomerReviewWithAppRow[];
    return rows.map(mapCustomerReviewWithApp);
  }

  replaceExchangeRates(
    rates: Readonly<Record<string, number>>,
    metadata: {
      sourceUpdatedAt: number;
      nextUpdateAt: number;
      provider: string;
    },
  ): number {
    return this.database.transaction(() => {
      const fetchedAt = Date.now();
      this.database.prepare("DELETE FROM exchange_rates").run();
      const insert = this.database.prepare(
        `INSERT INTO exchange_rates (
          currency_code, units_per_usd, source_updated_at, next_update_at,
          fetched_at, provider
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      let stored = 0;
      for (const [currencyCode, unitsPerUsd] of Object.entries(rates)) {
        stored += insert.run(
          currencyCode,
          unitsPerUsd,
          metadata.sourceUpdatedAt,
          metadata.nextUpdateAt,
          fetchedAt,
          metadata.provider,
        ).changes;
      }
      return stored;
    })();
  }

  getExchangeRate(currencyCode: string): ExchangeRate | undefined {
    const row = this.database
      .prepare("SELECT * FROM exchange_rates WHERE currency_code = ?")
      .get(currencyCode.toUpperCase()) as ExchangeRateRow | undefined;
    return row ? mapExchangeRate(row) : undefined;
  }

  exchangeRateCount(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM exchange_rates")
      .get() as { count: number };
    return row.count;
  }

  insertNotification(input: NewNotification): {
    created: boolean;
    notification: StoredNotification;
  } {
    const now = Date.now();
    const event = input.event;

    const result = this.database
      .prepare(
        `INSERT INTO notifications (
          notification_uuid, app_id, notification_type, subtype, environment,
          signed_date, transaction_id, original_transaction_id, product_id,
          message_html, payload_json, delivery_status, next_attempt_at, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        ON CONFLICT(notification_uuid) DO NOTHING`,
      )
      .run(
        event.notificationUuid,
        input.appId ?? null,
        event.notificationType,
        event.subtype ?? null,
        event.environment,
        event.signedDate,
        event.transactionId ?? null,
        event.originalTransactionId ?? null,
        event.productId ?? null,
        input.messageHtml,
        JSON.stringify(event.payload),
        now,
        now,
      );

    const notification = this.getNotificationByUuid(event.notificationUuid);
    if (!notification) {
      throw new Error("Notification insert did not produce a database record");
    }
    return { created: result.changes === 1, notification };
  }

  getNotificationByUuid(
    notificationUuid: string,
  ): StoredNotification | undefined {
    const row = this.database
      .prepare(
        `SELECT notifications.*, apps.name AS app_name
         FROM notifications
         LEFT JOIN apps ON apps.id = notifications.app_id
         WHERE notification_uuid = ?`,
      )
      .get(notificationUuid) as NotificationRow | undefined;
    return row ? mapNotification(row) : undefined;
  }

  getNotificationById(id: number): StoredNotification | undefined {
    const row = this.database
      .prepare(
        `SELECT notifications.*, apps.name AS app_name
         FROM notifications
         LEFT JOIN apps ON apps.id = notifications.app_id
         WHERE notifications.id = ?`,
      )
      .get(id) as NotificationRow | undefined;
    return row ? mapNotification(row) : undefined;
  }

  claimNotification(id: number): StoredNotification | undefined {
    const now = Date.now();
    const staleLock = now - 10 * 60 * 1000;
    const result = this.database
      .prepare(
        `UPDATE notifications
         SET delivery_status = 'sending', locked_at = ?
         WHERE id = ?
           AND (
             (delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?)
             OR (delivery_status = 'sending' AND locked_at < ?)
           )`,
      )
      .run(now, id, now, staleLock);
    return result.changes === 1 ? this.getNotificationById(id) : undefined;
  }

  claimDueNotifications(limit: number): StoredNotification[] {
    const now = Date.now();
    const staleLock = now - 10 * 60 * 1000;
    return this.database.transaction(() => {
      const rows = this.database
        .prepare(
          `SELECT id FROM notifications
           WHERE (
             delivery_status IN ('pending', 'retry') AND next_attempt_at <= ?
           ) OR (
             delivery_status = 'sending' AND locked_at < ?
           )
           ORDER BY next_attempt_at, id
           LIMIT ?`,
        )
        .all(now, staleLock, limit) as Array<{ id: number }>;

      const claimed: StoredNotification[] = [];
      for (const row of rows) {
        const notification = this.claimNotification(row.id);
        if (notification) {
          claimed.push(notification);
        }
      }
      return claimed;
    })();
  }

  markDelivered(id: number, telegramMessageId: number): void {
    this.database
      .prepare(
        `UPDATE notifications
         SET delivery_status = 'delivered',
             delivery_attempts = delivery_attempts + 1,
             telegram_message_id = ?,
             delivered_at = ?,
             locked_at = NULL,
             last_error = NULL
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(telegramMessageId, Date.now(), id);
  }

  markNotificationSuppressed(id: number): void {
    this.database
      .prepare(
        `UPDATE notifications
         SET delivery_status = 'suppressed',
             suppressed_at = ?,
             locked_at = NULL,
             last_error = NULL
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(Date.now(), id);
  }

  markForRetry(id: number, error: string, nextAttemptAt: number): void {
    this.database
      .prepare(
        `UPDATE notifications
         SET delivery_status = 'retry',
             delivery_attempts = delivery_attempts + 1,
             next_attempt_at = ?,
             locked_at = NULL,
             last_error = ?
         WHERE id = ? AND delivery_status = 'sending'`,
      )
      .run(nextAttemptAt, error.slice(0, 500), id);
  }

  pendingCount(): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM notifications
         WHERE delivery_status IN ('pending', 'sending', 'retry')`,
      )
      .get() as { count: number };
    return row.count;
  }

  recentNotifications(limit = 20): StoredNotification[] {
    const rows = this.database
      .prepare(
        `SELECT notifications.*, apps.name AS app_name
         FROM notifications
         LEFT JOIN apps ON apps.id = notifications.app_id
         ORDER BY notifications.id DESC
         LIMIT ?`,
      )
      .all(limit) as NotificationRow[];
    return rows.map(mapNotification);
  }
}

let singleton: AppDatabase | undefined;

export function getDatabase(): AppDatabase {
  singleton ??= new AppDatabase();
  return singleton;
}
