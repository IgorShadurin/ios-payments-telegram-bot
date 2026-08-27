import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram";

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

  it("can reply to an approved private chat without a configured topic", async () => {
    process.env.TELEGRAM_BOT_TOKEN = `1:${"x".repeat(24)}`;
    process.env.TELEGRAM_CHAT_ID = "-1001234567890";
    process.env.TELEGRAM_MESSAGE_THREAD_ID = "42";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ ok: true, result: { message_id: 100 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage("<b>Commands</b>", {
      chatId: "100000001",
      replyToMessageId: 7,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      chat_id: "100000001",
      reply_parameters: {
        message_id: 7,
        allow_sending_without_reply: true,
      },
    });
    expect(body).not.toHaveProperty("message_thread_id");
  });

  it("uploads a PNG report to the configured chat", async () => {
    process.env.TELEGRAM_BOT_TOKEN = `1:${"x".repeat(24)}`;
    process.env.TELEGRAM_CHAT_ID = "123";
    const directory = mkdtempSync(path.join(tmpdir(), "telegram-photo-"));
    const imagePath = path.join(directory, "report.png");
    writeFileSync(imagePath, Buffer.from("fake-png"));
    const fetchMock = vi.fn(
      async (_input: URL | RequestInfo, _init?: RequestInit) =>
        Response.json({ ok: true, result: { message_id: 101 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendTelegramPhoto(imagePath, "<b>Report</b>")).resolves.toBe(
      101,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/sendPhoto");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("caption")).toBe("<b>Report</b>");
    rmSync(directory, { recursive: true, force: true });
  });
});
