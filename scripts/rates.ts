import { AppDatabase } from "../src/lib/database";
import { logBackendFailure } from "../src/lib/diagnostics";
import { refreshExchangeRates } from "../src/lib/exchange-rates";

const startedAt = Date.now();

async function main(): Promise<void> {
  const database = new AppDatabase();
  try {
    const result = await refreshExchangeRates(database);
    console.log(JSON.stringify(result));
  } finally {
    database.close();
  }
}

main().catch((error) => {
  logBackendFailure("exchange_rate_worker_failed", error, {
    task: "rates",
    durationMs: Date.now() - startedAt,
  });
  process.exitCode = 1;
});
