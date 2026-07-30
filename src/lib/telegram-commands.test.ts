import { describe, expect, it } from "vitest";
import {
  formatTelegramCommandList,
  formatTrackedApps,
  responseForTelegramMessage,
} from "./telegram-commands";
import type { RegisteredApp } from "./types";

const apps: RegisteredApp[] = [
  {
    id: 1,
    name: "Example <One>",
    bundleId: "com.example.one",
    appAppleId: 123456789,
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 2,
    name: "Removed",
    bundleId: "com.example.removed",
    appAppleId: 987654321,
    enabled: false,
    createdAt: 1,
    updatedAt: 1,
  },
];

describe("Telegram commands", () => {
  it("lists only enabled apps and escapes Telegram HTML", () => {
    const message = formatTrackedApps(apps);
    expect(message).toContain("Tracked iOS apps (1)");
    expect(message).toContain("Example &lt;One&gt;");
    expect(message).toContain("<code>com.example.one</code>");
    expect(message).not.toContain("com.example.removed");
  });

  it("handles the apps command with bot mentions and arguments", () => {
    expect(responseForTelegramMessage("/apps@MyBot now", apps)).toBe(
      formatTrackedApps(apps),
    );
  });

  it("shows every command for unknown text and unsupported messages", () => {
    const commands = formatTelegramCommandList();
    expect(responseForTelegramMessage("/unknown", apps)).toBe(commands);
    expect(responseForTelegramMessage("hello", apps)).toBe(commands);
    expect(responseForTelegramMessage(undefined, apps)).toBe(commands);
    expect(commands).toContain("/apps");
    expect(commands).toContain("/help");
    expect(commands).toContain("/start");
  });
});
