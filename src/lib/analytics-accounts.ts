import { AppStoreAnalyticsClient } from "./app-store-analytics";
import { createAppStoreConnectToken } from "./app-store-connect";
import {
  type AnalyticsAccountConfig,
  type AppStoreConnectConfig,
  getAnalyticsAccountConfigs,
  getAppStoreAnalyticsSetupConfig,
} from "./config";
import { logBackendFailure } from "./diagnostics";
import type { RegisteredApp } from "./types";

export class AnalyticsAccounts {
  private readonly assignments = new Map<number, AnalyticsAccountConfig>();
  private readonly clients = new Map<string, AppStoreAnalyticsClient>();
  private readonly setupClients = new Map<string, AppStoreAnalyticsClient>();

  constructor(
    private readonly accounts = getAnalyticsAccountConfigs(),
    private readonly createClient = (credentials: AppStoreConnectConfig) =>
      new AppStoreAnalyticsClient(() =>
        createAppStoreConnectToken(credentials),
      ),
    private readonly defaultSetupCredentials = getAppStoreAnalyticsSetupConfig,
  ) {
    for (const account of accounts) {
      for (const appAppleId of account.appAppleIds) {
        this.assignments.set(appAppleId, account);
      }
    }
  }

  private accountFor(appAppleId: number): AnalyticsAccountConfig {
    const account =
      this.assignments.get(appAppleId) ??
      this.accounts.find((candidate) => candidate.id === "default");
    if (!account) throw new Error("No analytics account configured for app");
    return account;
  }

  forApp(appAppleId: number) {
    const account = this.accountFor(appAppleId);
    let client = this.clients.get(account.id);
    if (!client) {
      client = this.createClient(account.credentials);
      this.clients.set(account.id, client);
    }
    return {
      accountId: account.id,
      client,
      getSetupClient: () => {
        let setupClient = this.setupClients.get(account.id);
        if (!setupClient) {
          const credentials =
            account.setupCredentials ??
            (account.id === "default"
              ? this.defaultSetupCredentials()
              : account.credentials);
          setupClient = this.createClient(credentials);
          this.setupClients.set(account.id, setupClient);
        }
        return setupClient;
      },
    };
  }

  async collect<T>(
    app: RegisteredApp,
    collect: (
      client: AppStoreAnalyticsClient,
      getSetupClient: () => AppStoreAnalyticsClient,
    ) => Promise<T>,
  ): Promise<T> {
    const { accountId, client, getSetupClient } = this.forApp(app.appAppleId);
    const startedAt = Date.now();
    try {
      return await collect(client, getSetupClient);
    } catch (error) {
      logBackendFailure("analytics_app_failed", error, {
        accountId,
        appAppleId: app.appAppleId,
        appBundleId: app.bundleId,
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  }

  groupApps<T extends { appAppleId: number }>(apps: T[]): T[][] {
    const groups = new Map<string, T[]>();
    for (const app of apps) {
      const id = this.accountFor(app.appAppleId).id;
      const group = groups.get(id) ?? [];
      group.push(app);
      groups.set(id, group);
    }
    return [...groups.values()];
  }
}
