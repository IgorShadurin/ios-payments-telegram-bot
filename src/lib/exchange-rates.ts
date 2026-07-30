import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AppDatabase } from "./database";

const RATES_URL = "https://open.er-api.com/v6/latest/USD";
export const EXCHANGE_RATE_PROVIDER = "ExchangeRate-API";
export const EXCHANGE_RATE_PROVIDER_URL = "https://www.exchangerate-api.com";

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const responseSchema = z.object({
  result: z.literal("success"),
  provider: z.string().url(),
  time_last_update_unix: z.number().int().positive(),
  time_next_update_unix: z.number().int().positive(),
  base_code: z.literal("USD"),
  rates: z.record(
    currencyCodeSchema,
    z.number().finite().positive().max(1_000_000_000),
  ),
});

export class ExchangeRateError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ExchangeRateError";
  }
}

async function fetchOnce(
  fetchImplementation: typeof fetch,
): Promise<z.infer<typeof responseSchema>> {
  let response: Response;
  try {
    response = await fetchImplementation(RATES_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ExchangeRateError("Exchange-rate request failed");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ExchangeRateError(
      `Exchange-rate provider returned HTTP ${response.status}`,
      response.status,
    );
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
    throw new ExchangeRateError("Exchange-rate response is too large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 512 * 1024) {
    throw new ExchangeRateError("Exchange-rate response is too large");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ExchangeRateError("Exchange-rate provider returned invalid JSON");
  }
  const parsed = responseSchema.safeParse(body);
  if (
    !parsed.success ||
    Object.keys(parsed.data.rates).length < 100 ||
    parsed.data.rates.USD !== 1
  ) {
    throw new ExchangeRateError(
      "Exchange-rate provider returned an unexpected response",
    );
  }
  return parsed.data;
}

function retryable(error: unknown): error is ExchangeRateError {
  return (
    error instanceof ExchangeRateError &&
    (error.status === undefined ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599))
  );
}

export async function refreshExchangeRates(
  database: AppDatabase,
  fetchImplementation: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): Promise<{
  stored: number;
  sourceUpdatedAt: number;
  nextUpdateAt: number;
}> {
  let response: z.infer<typeof responseSchema> | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchOnce(fetchImplementation);
      break;
    } catch (error) {
      if (!retryable(error) || attempt === 2) {
        throw error;
      }
      await wait([500, 1_500][attempt]);
    }
  }
  if (!response) {
    throw new ExchangeRateError("Exchange-rate refresh failed");
  }

  const sourceUpdatedAt = response.time_last_update_unix * 1_000;
  const nextUpdateAt = response.time_next_update_unix * 1_000;
  const stored = database.replaceExchangeRates(response.rates, {
    sourceUpdatedAt,
    nextUpdateAt,
    provider: EXCHANGE_RATE_PROVIDER,
  });
  return { stored, sourceUpdatedAt, nextUpdateAt };
}
