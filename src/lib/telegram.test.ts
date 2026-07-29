import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "./telegram";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_MESSAGE_THREAD_ID;
});

describe("sendTelegramMessage", () => {
  it("posts escaped HTML to the configured chat and topic", async () => {
    process.env.TELEGRAM_BOT_TOKEN = `1:${"x".repeat(24)}`;
    process.env.TELEGRAM_CHAT_ID = "-1001234567890";
    process.env.TELEGRAM_MESSAGE_THREAD_ID = "42";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ ok: true, result: { message_id: 99 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramMessage("<b>Renewed</b>")).resolves.toBe(99);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("api.telegram.org/bot1%3A");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      chat_id: "-1001234567890",
      message_thread_id: 42,
      text: "<b>Renewed</b>",
      parse_mode: "HTML",
    });
  });

  it("preserves Telegram's retry-after instruction", async () => {
    process.env.TELEGRAM_BOT_TOKEN = `1:${"x".repeat(24)}`;
    process.env.TELEGRAM_CHAT_ID = "123";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            description: "Too Many Requests",
            parameters: { retry_after: 7 },
          },
          { status: 429 },
        ),
      ),
    );

    await expect(sendTelegramMessage("Retry me")).rejects.toMatchObject({
      retryAfterSeconds: 7,
    });
  });
});
