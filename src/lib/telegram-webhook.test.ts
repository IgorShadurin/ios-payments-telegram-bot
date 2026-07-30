import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isApprovedPrivateMessage,
  isTelegramWebhookAuthorized,
  telegramUpdateSchema,
} from "./telegram-webhook";

const secret = "a".repeat(64);

beforeEach(() => {
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  process.env.TELEGRAM_ALLOWED_USER_IDS = "100000001,100000002";
});

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
});

describe("Telegram webhook security", () => {
  it("accepts only the exact Telegram secret header", () => {
    expect(
      isTelegramWebhookAuthorized(
        new Request("https://example.test", {
          headers: { "x-telegram-bot-api-secret-token": secret },
        }),
      ),
    ).toBe(true);
    expect(
      isTelegramWebhookAuthorized(
        new Request("https://example.test", {
          headers: {
            "x-telegram-bot-api-secret-token": "b".repeat(64),
          },
        }),
      ),
    ).toBe(false);
  });

  it("approves allowlisted users only in their private chat", () => {
    expect(
      isApprovedPrivateMessage({
        from: { id: 100000001 },
        chat: { id: 100000001, type: "private" },
      }),
    ).toBe(true);
    expect(
      isApprovedPrivateMessage({
        from: { id: 42 },
        chat: { id: 42, type: "private" },
      }),
    ).toBe(false);
    expect(
      isApprovedPrivateMessage({
        from: { id: 100000001 },
        chat: { id: -100123, type: "supergroup" },
      }),
    ).toBe(false);
    expect(
      isApprovedPrivateMessage({
        from: { id: 100000001, is_bot: true },
        chat: { id: 100000001, type: "private" },
      }),
    ).toBe(false);
  });

  it("parses a bounded Telegram message update", () => {
    expect(
      telegramUpdateSchema.parse({
        update_id: 1,
        message: {
          message_id: 2,
          from: { id: 100000001, is_bot: false },
          chat: { id: 100000001, type: "private" },
          text: "/apps",
        },
      }).message?.text,
    ).toBe("/apps");
  });
});
