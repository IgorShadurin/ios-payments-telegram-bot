import { escapeTelegramHtml } from "./message";
import type { RegisteredApp } from "./types";

export const telegramBotCommands = [
  { command: "apps", description: "Show tracked iOS apps" },
  { command: "help", description: "Show all commands" },
  { command: "start", description: "Show all commands" },
] as const;

export function formatTelegramCommandList(): string {
  return [
    "<b>Available commands</b>",
    "",
    "/apps — Show tracked iOS apps",
    "/help — Show this command list",
    "/start — Show this command list",
  ].join("\n");
}

export function formatTrackedApps(apps: RegisteredApp[]): string {
  const enabledApps = apps.filter((app) => app.enabled);
  if (enabledApps.length === 0) {
    return "<b>Tracked iOS apps</b>\n\nNo apps are currently enabled.";
  }

  const heading = `<b>Tracked iOS apps (${enabledApps.length})</b>`;
  const blocks: string[] = [];
  let shown = 0;
  for (const app of enabledApps) {
    const block = [
      `✅ <b>${escapeTelegramHtml(app.name)}</b>`,
      `<code>${escapeTelegramHtml(app.bundleId)}</code> · Apple ID ${app.appAppleId}`,
    ].join("\n");
    const candidate = [heading, ...blocks, block].join("\n\n");
    if (candidate.length > 3_800) {
      break;
    }
    blocks.push(block);
    shown += 1;
  }

  if (shown < enabledApps.length) {
    blocks.push(`… and ${enabledApps.length - shown} more`);
  }
  return [heading, ...blocks].join("\n\n");
}

function parseCommand(text: string | undefined): string | undefined {
  const token = text?.trim().split(/\s+/, 1)[0];
  const match = token?.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?$/i);
  return match?.[1]?.toLowerCase();
}

export function responseForTelegramMessage(
  text: string | undefined,
  apps: RegisteredApp[],
): string {
  const command = parseCommand(text);
  if (command === "apps") {
    return formatTrackedApps(apps);
  }
  return formatTelegramCommandList();
}
