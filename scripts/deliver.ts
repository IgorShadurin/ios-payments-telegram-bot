import { parseArgs } from "node:util";
import { z } from "zod";
import { AppDatabase } from "../src/lib/database";
import { deliverDueNotifications } from "../src/lib/delivery";

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      limit: { type: "string", default: "100" },
    },
    strict: true,
  });
  const limit = z.coerce.number().int().min(1).max(500).parse(values.limit);
  const database = new AppDatabase();
  try {
    const result = await deliverDueNotifications(database, limit);
    console.log(JSON.stringify(result));
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Delivery failed");
  process.exitCode = 1;
});
