import { afterEach, describe, expect, it, vi } from "vitest";
import { configureTelegramBot } from "./telegram-setup";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  delete process.env.TELEGRAM_ALLOWED_USER_IDS;
});

describe("Telegram bot setup", () => {
  it("sets a secret webhook and commands only for approved chats", async () => {
    process.env.TELEGRAM_BOT_TOKEN = `1:${"x".repeat(24)}`;
    process.env.TELEGRAM_CHAT_ID = "100000001";
    process.env.TELEGRAM_WEBHOOK_SECRET = "a".repeat(64);
    process.env.TELEGRAM_ALLOWED_USER_IDS = "100000001,100000002";
    const webhookUrl = "https://example.test/api/telegram/webhook";
    const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = String(input).split("/").at(-1) ?? "";
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ method, body });
        if (method === "getWebhookInfo") {
          return Response.json({
            ok: true,
            result: {
              url: webhookUrl,
              pending_update_count: 0,
              allowed_updates: ["message"],
            },
          });
        }
        return Response.json({ ok: true, result: true });
      }),
    );

    await expect(configureTelegramBot(webhookUrl)).resolves.toEqual({
      webhookUrl,
      commandScopes: 2,
      pendingUpdates: 0,
      allowedUpdates: ["message"],
    });
    expect(calls[0]).toMatchObject({
      method: "setWebhook",
      body: {
        url: webhookUrl,
        secret_token: "a".repeat(64),
        allowed_updates: ["message"],
        drop_pending_updates: true,
      },
    });
    const commandCalls = calls.filter(
      (call) => call.method === "setMyCommands",
    );
    expect(commandCalls).toHaveLength(2);
    expect(commandCalls.map((call) => call.body.scope)).toEqual([
      { type: "chat", chat_id: 100000001 },
      { type: "chat", chat_id: 100000002 },
    ]);
  });
});
