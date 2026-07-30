import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "./database";
import { ExchangeRateError, refreshExchangeRates } from "./exchange-rates";

let directory: string;
let database: AppDatabase;

function rates(): Record<string, number> {
  const result: Record<string, number> = { USD: 1, JPY: 156.25 };
  for (let index = 0; index < 100; index += 1) {
    const first = String.fromCharCode(65 + Math.floor(index / 26));
    const second = String.fromCharCode(65 + (index % 26));
    result[`C${first}${second}`] = index + 1;
  }
  return result;
}

function successfulResponse() {
  return new Response(
    JSON.stringify({
      result: "success",
      provider: "https://www.exchangerate-api.com",
      time_last_update_unix: 1_750_000_000,
      time_next_update_unix: 1_750_086_400,
      base_code: "USD",
      rates: rates(),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ios-rates-"));
  database = new AppDatabase(path.join(directory, "test.sqlite"));
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("exchange-rate refresh", () => {
  it("validates and persistently stores the complete USD rate table", async () => {
    const fetchMock = vi.fn(async () => successfulResponse());

    await expect(
      refreshExchangeRates(database, fetchMock as unknown as typeof fetch),
    ).resolves.toMatchObject({
      stored: 102,
      sourceUpdatedAt: 1_750_000_000_000,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.er-api.com/v6/latest/USD",
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );
    expect(database.exchangeRateCount()).toBe(102);
    expect(database.getExchangeRate("jpy")).toMatchObject({
      currencyCode: "JPY",
      unitsPerUsd: 156.25,
      provider: "ExchangeRate-API",
    });
  });

  it("retries a temporary network failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(successfulResponse());
    const wait = vi.fn(async () => undefined);

    await refreshExchangeRates(
      database,
      fetchMock as unknown as typeof fetch,
      wait,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(500);
  });

  it("rejects incomplete rate tables without replacing stored rates", async () => {
    database.replaceExchangeRates(
      { USD: 1, JPY: 150 },
      {
        sourceUpdatedAt: 1,
        nextUpdateAt: 2,
        provider: "existing",
      },
    );
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            result: "success",
            provider: "https://www.exchangerate-api.com",
            time_last_update_unix: 1_750_000_000,
            time_next_update_unix: 1_750_086_400,
            base_code: "USD",
            rates: { USD: 1, JPY: 156.25 },
          }),
          { status: 200 },
        ),
    );

    await expect(
      refreshExchangeRates(database, fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(ExchangeRateError);
    expect(database.exchangeRateCount()).toBe(2);
    expect(database.getExchangeRate("JPY")?.unitsPerUsd).toBe(150);
  });
});
