import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getAppStoreAnalyticsConfig, getAppStoreConnectConfig } from "./config";

const managedKeys = [
  "APP_STORE_CONNECT_KEY_TYPE",
  "APP_STORE_CONNECT_ISSUER_ID",
  "APP_STORE_CONNECT_KEY_ID",
  "APP_STORE_CONNECT_PRIVATE_KEY",
  "APP_STORE_CONNECT_PRIVATE_KEY_BASE64",
  "APPLE_ANALYTICS_KEY_TYPE",
  "APPLE_ANALYTICS_ISSUER_ID",
  "APPLE_ANALYTICS_KEY_ID",
  "APPLE_ANALYTICS_PRIVATE_KEY",
  "APPLE_ANALYTICS_PRIVATE_KEY_BASE64",
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
});
