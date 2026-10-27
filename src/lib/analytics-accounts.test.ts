import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AnalyticsAccounts } from "./analytics-accounts";
import {
  AppStoreAnalyticsClient,
  AppStoreAnalyticsError,
} from "./app-store-analytics";
import { createAppStoreConnectToken } from "./app-store-connect";
import type { AnalyticsAccountConfig, AppStoreConnectConfig } from "./config";

const privateKey = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();
function credentials(keyId: string, issuerId: string): AppStoreConnectConfig {
  return { keyType: "team", issuerId, keyId, privateKey };
}
const configs: AnalyticsAccountConfig[] = [
  {
    id: "default",
    appAppleIds: [],
    credentials: credentials("OLDREAD", "old-issuer"),
  },
  {
    id: "wowcoded",
    appAppleIds: [6801154513],
    credentials: credentials("NEWREAD", "new-issuer"),
    setupCredentials: credentials("NEWADMIN", "new-issuer"),
  },
];

describe("analytics account routing", () => {
  it("uses each owner's read and setup credentials and caches clients by account", async () => {
    const calls: Array<{ path: string; key: string; issuer: string }> = [];
    const fetcher = vi.fn(async (url: URL, init?: RequestInit) => {
      const parts = new Headers(init?.headers)
        .get("authorization")
        ?.slice(7)
        .split(".");
      if (!parts) throw new Error("Missing token");
      calls.push({
        path: url.pathname,
        key: JSON.parse(Buffer.from(parts[0], "base64url").toString()).kid,
        issuer: JSON.parse(Buffer.from(parts[1], "base64url").toString()).iss,
      });
      return Response.json(
        init?.method === "POST"
          ? {
              data: {
                type: "analyticsReportRequests",
                id: "new-request",
                attributes: { accessType: "ONGOING" },
              },
            }
          : { data: [], links: {} },
      );
    });
    const defaultSetup = vi.fn(() => credentials("OLDADMIN", "old-issuer"));
    const factory = vi.fn(
      (config: AppStoreConnectConfig) =>
        new AppStoreAnalyticsClient(() => createAppStoreConnectToken(config), {
          fetchImplementation: fetcher,
        }),
    );
    const accounts = new AnalyticsAccounts(configs, factory, defaultSetup);
    const old = accounts.forApp(123);
    await old.client.findOngoingReportRequest(123);
    const transferred = accounts.forApp(6801154513);
    await transferred.client.ensureOngoingReportRequest(
      6801154513,
      transferred.getSetupClient,
    );
    expect(defaultSetup).not.toHaveBeenCalled();
    await old.getSetupClient().createOngoingReportRequest(123);
    expect(calls).toEqual([
      {
        path: "/v1/apps/123/analyticsReportRequests",
        key: "OLDREAD",
        issuer: "old-issuer",
      },
      {
        path: "/v1/apps/6801154513/analyticsReportRequests",
        key: "NEWREAD",
        issuer: "new-issuer",
      },
      {
        path: "/v1/analyticsReportRequests",
        key: "NEWADMIN",
        issuer: "new-issuer",
      },
      {
        path: "/v1/analyticsReportRequests",
        key: "OLDADMIN",
        issuer: "old-issuer",
      },
    ]);
    expect(accounts.forApp(456).client).toBe(old.client);
    expect(accounts.forApp(6801154513).getSetupClient()).toBe(
      transferred.getSetupClient(),
    );
    expect(factory).toHaveBeenCalledTimes(4);
  });

  it("keeps publication inference within each account", () => {
    const accounts = new AnalyticsAccounts(configs);
    const rows = [
      { appAppleId: 123, downloads: 5 },
      { appAppleId: 6801154513, downloads: undefined },
      { appAppleId: 456, downloads: undefined },
    ];
    expect(accounts.groupApps(rows)).toEqual([[rows[0], rows[2]], [rows[1]]]);
  });

  it("never falls back to the old account's Admin key for a transferred app", () => {
    const noSetup = configs.map(
      ({ setupCredentials: _setup, ...account }) => account,
    );
    const factory = vi.fn(() => new AppStoreAnalyticsClient("test"));
    const oldSetup = vi.fn(() => credentials("OLDADMIN", "old-issuer"));
    const accounts = new AnalyticsAccounts(noSetup, factory, oldSetup);
    accounts.forApp(6801154513).getSetupClient();
    expect(factory).toHaveBeenLastCalledWith(configs[1].credentials);
    expect(oldSetup).not.toHaveBeenCalled();
  });

  it("logs the failing app and account while preserving permission failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const accounts = new AnalyticsAccounts(configs);
      const error = new AppStoreAnalyticsError("Forbidden", 403);
      await expect(
        accounts.collect(
          {
            id: 1,
            name: "Bike",
            appAppleId: 6801154513,
            bundleId: "com.wowcoded.speedometergps",
            enabled: true,
            createdAt: 0,
            updatedAt: 0,
          },
          async () => {
            throw error;
          },
        ),
      ).rejects.toBe(error);
      expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({
        event: "analytics_app_failed",
        accountId: "wowcoded",
        appAppleId: 6801154513,
        status: 403,
      });
    } finally {
      log.mockRestore();
    }
  });
});
