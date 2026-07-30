import { AppDatabase } from "../src/lib/database";
import { refreshExchangeRates } from "../src/lib/exchange-rates";

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
  console.error(
    error instanceof Error ? error.message : "Exchange-rate refresh failed",
  );
  process.exitCode = 1;
});
