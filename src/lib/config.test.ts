import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  getAnalyticsAccountConfigs,
  getAppStoreAnalyticsConfig,
  getAppStoreAnalyticsSetupConfig,
  getAppStoreConnectConfig,
  getReviewAccountConfigs,
} from "./config";

const managedKeys = [
  "APP_STORE_CONNECT_KEY_TYPE",
  "APP_STORE_CONNECT_ISSUER_ID",
  "APP_STORE_CONNECT_KEY_ID",
  "APP_STORE_CONNECT_PRIVATE_KEY",
  "APP_STORE_CONNECT_PRIVATE_KEY_BASE64",
  "APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON",
  "APPLE_ANALYTICS_ACCOUNTS_JSON",
  "APPLE_ANALYTICS_KEY_TYPE",
  "APPLE_ANALYTICS_ISSUER_ID",
  "APPLE_ANALYTICS_KEY_ID",
  "APPLE_ANALYTICS_PRIVATE_KEY",
  "APPLE_ANALYTICS_PRIVATE_KEY_BASE64",
  "APPLE_ANALYTICS_SETUP_KEY_TYPE",
  "APPLE_ANALYTICS_SETUP_ISSUER_ID",
  "APPLE_ANALYTICS_SETUP_KEY_ID",
  "APPLE_ANALYTICS_SETUP_PRIVATE_KEY",
  "APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64",
] as const;
const originalValues = new Map(
  managedKeys.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of managedKeys) {
    const original = originalValues.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

describe("App Store Connect configuration", () => {
  function configureReviewAccounts() {
    const key = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .privateKey.export({ format: "pem", type: "pkcs8" })
      .toString();
    process.env.APP_STORE_CONNECT_KEY_TYPE = "team";
    process.env.APP_STORE_CONNECT_ISSUER_ID =
      "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1";
    process.env.APP_STORE_CONNECT_KEY_ID = "OLDKEY";
    process.env.APP_STORE_CONNECT_PRIVATE_KEY = key;
    delete process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64;
    return {
      id: "wowcoded",
      appAppleIds: [6801154513],
      keyType: "team",
      issuerId: "69a6de70-5c3f-47e3-e053-5b8c7c11a4d2",
      keyId: "NEWKEY",
      privateKeyBase64: Buffer.from(key).toString("base64"),
    };
  }

  it("loads additional review credentials without replacing the default", () => {
    const extra = configureReviewAccounts();
    process.env.APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON = JSON.stringify([
      extra,
    ]);
    expect(getReviewAccountConfigs()).toMatchObject([
      { id: "default", appAppleIds: [], credentials: { keyId: "OLDKEY" } },
      {
        id: "wowcoded",
        appAppleIds: [6801154513],
        credentials: { keyId: "NEWKEY", issuerId: extra.issuerId },
      },
    ]);
    expect(getAppStoreConnectConfig().keyId).toBe("OLDKEY");
    delete process.env.APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON;
    expect(getReviewAccountConfigs()).toHaveLength(1);
  });

  it("loads separate analytics read/setup keys for the transferred account", () => {
    const extra = configureReviewAccounts();
    const {
      id: _id,
      appAppleIds: _apps,
      ...setup
    } = { ...extra, keyId: "ADMINKEY" };
    process.env.APPLE_ANALYTICS_ACCOUNTS_JSON = JSON.stringify([
      { ...extra, setup },
    ]);
    expect(getAnalyticsAccountConfigs()).toMatchObject([
      { id: "default" },
      {
        id: "wowcoded",
        appAppleIds: [6801154513],
        credentials: { keyId: "NEWKEY" },
        setupCredentials: { keyId: "ADMINKEY" },
      },
    ]);
  });

  it("rejects ambiguous analytics routing, mismatched setup owners, and invalid secrets safely", () => {
    const extra = configureReviewAccounts();
    const { id: _id, appAppleIds: _apps, ...setup } = extra;
    for (const value of [
      [extra, extra],
      [extra, { ...extra, id: "other" }],
      [{ ...extra, id: "default" }],
      [
        {
          ...extra,
          setup: { ...setup, issuerId: "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1" },
        },
      ],
      [{ ...extra, privateKeyBase64: "SECRET" }],
    ]) {
      process.env.APPLE_ANALYTICS_ACCOUNTS_JSON = JSON.stringify(value);
      expect(getAnalyticsAccountConfigs).toThrow(
        /^App Store analytics configuration is invalid: APPLE_ANALYTICS_ACCOUNTS_JSON$/,
      );
    }
  });

  it("rejects duplicate account names, duplicate app assignments, and invalid credentials without exposing secrets", () => {
    const extra = configureReviewAccounts();
    for (const entries of [
      [extra, extra],
      [extra, { ...extra, id: "another" }],
      [{ ...extra, id: "default" }],
      [{ ...extra, issuerId: undefined }],
      [{ ...extra, privateKeyBase64: "sensitive-key-not-base64" }],
    ]) {
      process.env.APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON =
        JSON.stringify(entries);
      expect(getReviewAccountConfigs).toThrow(
        /^App Store Connect configuration is invalid: APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON$/,
      );
    }
    process.env.APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON =
      "{sensitive-key-invalid-json";
    expect(getReviewAccountConfigs).toThrow(
      /^App Store Connect configuration is invalid: APP_STORE_CONNECT_REVIEW_ACCOUNTS_JSON$/,
    );
  });

  it("accepts Apple's canonical issuer IDs even without RFC UUID version bits", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.APP_STORE_CONNECT_KEY_TYPE = "team";
    process.env.APP_STORE_CONNECT_ISSUER_ID =
      "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1";
    process.env.APP_STORE_CONNECT_KEY_ID = "ABC123DEFG";
    process.env.APP_STORE_CONNECT_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64");
    delete process.env.APP_STORE_CONNECT_PRIVATE_KEY;

    expect(getAppStoreConnectConfig()).toMatchObject({
      keyType: "team",
      issuerId: "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1",
      keyId: "ABC123DEFG",
    });
  });

  it("uses dedicated analytics credentials without replacing review credentials", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.APPLE_ANALYTICS_KEY_TYPE = "team";
    process.env.APPLE_ANALYTICS_ISSUER_ID =
      "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1";
    process.env.APPLE_ANALYTICS_KEY_ID = "REPORTKEY";
    process.env.APPLE_ANALYTICS_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64");

    expect(getAppStoreAnalyticsConfig()).toMatchObject({
      keyId: "REPORTKEY",
      keyType: "team",
    });
  });

  it("uses a separate Admin credential only for analytics setup", () => {
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    process.env.APPLE_ANALYTICS_SETUP_KEY_TYPE = "team";
    process.env.APPLE_ANALYTICS_SETUP_ISSUER_ID =
      "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1";
    process.env.APPLE_ANALYTICS_SETUP_KEY_ID = "SETUPKEY";
    process.env.APPLE_ANALYTICS_SETUP_PRIVATE_KEY_BASE64 = Buffer.from(
      privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    ).toString("base64");

    expect(getAppStoreAnalyticsSetupConfig()).toMatchObject({
      keyId: "SETUPKEY",
      keyType: "team",
    });
  });
});
