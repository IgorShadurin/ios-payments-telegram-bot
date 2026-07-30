import { parseArgs } from "node:util";
import { z } from "zod";
import { configureTelegramBot } from "../src/lib/telegram-setup";

const webhookUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => value.startsWith("https://"), "Webhook must use HTTPS");

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: "string" },
    },
    strict: true,
  });
  const webhookUrl = webhookUrlSchema.parse(values.url);
  const result = await configureTelegramBot(webhookUrl);
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Telegram configuration failed",
  );
  process.exitCode = 1;
});
