import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppleNotificationError,
  decodeUntrustedRoutingHint,
  makePaymentEvent,
  verifyAppleNotification,
} from "./apple";
import { APPLE_ROOT_CERTIFICATES } from "./apple-root-certificates";
import { AppDatabase } from "./database";

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJws(payload: unknown): string {
  return `${segment({ alg: "ES256", x5c: [] })}.${segment(payload)}.${segment("fake")}`;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Apple notification routing", () => {
  it("extracts a production app hint without treating it as verified", () => {
    const hint = decodeUntrustedRoutingHint(
      fakeJws({
        data: {
          bundleId: "com.example.app",
          environment: "Production",
        },
      }),
    );

    expect(hint).toEqual({
      bundleId: "com.example.app",
      environment: "Production",
    });
  });

  it("rejects unsupported environments", () => {
    expect(() =>
      decodeUntrustedRoutingHint(
        fakeJws({
          data: { bundleId: "com.example.app", environment: "LocalTesting" },
        }),
      ),
    ).toThrowError(AppleNotificationError);
  });

  it("does not accept a routed payload with a fake signature", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "ios-payments-test-"));
    temporaryDirectories.push(directory);
    const database = new AppDatabase(path.join(directory, "test.sqlite"));
    database.addApp("Example", "com.example.app", 123456789);
    process.env.APPLE_ENABLE_ONLINE_CHECKS = "false";

    await expect(
      verifyAppleNotification(
        fakeJws({
          notificationType: "ONE_TIME_CHARGE",
          notificationUUID: "69af5e64-44eb-42d0-891c-9b36fdb9d7f2",
          signedDate: Date.now(),
          data: {
            appAppleId: 123456789,
            bundleId: "com.example.app",
            environment: "Production",
          },
        }),
        database,
      ),
    ).rejects.toMatchObject({ code: "VERIFICATION_FAILED" });

    database.close();
    delete process.env.APPLE_ENABLE_ONLINE_CHECKS;
  });
});

describe("Apple payment event extraction", () => {
  it("promotes verified free-trial fields for delivery formatting", () => {
    const event = makePaymentEvent(
      {
        notificationType: "SUBSCRIBED",
        subtype: "INITIAL_BUY",
        notificationUUID: "69af5e64-44eb-42d0-891c-9b36fdb9d7f2",
        signedDate: 1_750_000_000_000,
      },
      "Production",
      {
        transactionId: "2000000123456789",
        productId: "premium.monthly",
        type: "Auto-Renewable Subscription",
        transactionReason: "PURCHASE",
        inAppOwnershipType: "PURCHASED",
        offerType: 1,
        offerDiscountType: "FREE_TRIAL",
        offerPeriod: "P1W",
        price: 0,
        currency: "USD",
        expiresDate: 1_750_604_800_000,
      },
      {
        productId: "premium.monthly",
        offerType: 1,
        offerDiscountType: "FREE_TRIAL",
        offerPeriod: "P1W",
        renewalPrice: 4_990,
        currency: "USD",
        renewalDate: 1_750_604_800_000,
      },
    );

    expect(event).toMatchObject({
      notificationType: "SUBSCRIBED",
      subtype: "INITIAL_BUY",
      transactionReason: "PURCHASE",
      inAppOwnershipType: "PURCHASED",
      offerType: 1,
      offerDiscountType: "FREE_TRIAL",
      offerPeriod: "P1W",
      price: 0,
      renewalPrice: 4_990,
      renewalCurrency: "USD",
    });
  });
});

describe("bundled Apple root certificates", () => {
  it("matches the fingerprints published in the source comments", () => {
    const fingerprints = APPLE_ROOT_CERTIFICATES.map((certificate) =>
      createHash("sha256").update(certificate).digest("hex"),
    );
    expect(fingerprints).toEqual([
      "b0b1730ecbc7ff4505142c49f1295e6eda6bcaed7e2c68c5be91b5a11001f024",
      "c2b9b042dd57830e7d117dac55ac8ae19407d38e41d88f3215bc3a890444a050",
      "63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179",
    ]);
  });
});
