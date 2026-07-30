import { generateKeyPairSync, type KeyObject, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AppStoreConnectError,
  createAppStoreConnectToken,
  fetchCustomerReviewPage,
} from "./app-store-connect";
import type { AppStoreConnectConfig } from "./config";

function keyConfig(): {
  config: AppStoreConnectConfig;
  publicKey: KeyObject;
} {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    config: {
      keyType: "team",
      issuerId: "69a6de70-5c3f-47e3-e053-5b8c7c11a4d1",
      keyId: "ABC123DEFG",
      privateKey: privateKey
        .export({ format: "pem", type: "pkcs8" })
        .toString(),
    },
    publicKey,
  };
}

describe("App Store Connect client", () => {
  it("creates a short-lived, valid ES256 API token", () => {
    const { config, publicKey } = keyConfig();
    const token = createAppStoreConnectToken(config, 1_750_000_000_000);
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: config.issuerId,
      iat: 1_750_000_000,
      exp: 1_750_000_900,
      aud: "appstoreconnect-v1",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("uses Apple's subject claim for an individual API key", () => {
    const { config } = keyConfig();
    const token = createAppStoreConnectToken({
      ...config,
      keyType: "individual",
      issuerId: undefined,
    });
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );

    expect(payload.sub).toBe("user");
    expect(payload.iss).toBeUndefined();
  });

  it("fetches and validates a review page without exposing the token in the URL", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.appstoreconnect.apple.com");
      expect(url.pathname).toBe("/v1/apps/123456789/customerReviews");
      expect(url.searchParams.get("limit")).toBe("200");
      expect(url.searchParams.get("sort")).toBe("-createdDate");
      return new Response(
        JSON.stringify({
          data: [
            {
              type: "customerReviews",
              id: "review-1",
              attributes: {
                rating: 5,
                title: "Excellent",
                body: "Useful app",
                reviewerNickname: "Reviewer",
                createdDate: "2026-07-30T10:00:00Z",
                territory: "USA",
              },
            },
          ],
          links: {
            self: url.toString(),
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const page = await fetchCustomerReviewPage(
      123456789,
      "secret-token",
      undefined,
      fetchMock as unknown as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer secret-token",
        }),
      }),
    );
    expect(page).toEqual({
      reviews: [
        {
          id: "review-1",
          rating: 5,
          title: "Excellent",
          body: "Useful app",
          reviewerNickname: "Reviewer",
          createdDate: "2026-07-30T10:00:00Z",
          territory: "USA",
        },
      ],
      nextUrl: undefined,
    });
  });

  it("rejects pagination URLs outside Apple's API origin", async () => {
    await expect(
      fetchCustomerReviewPage(
        123456789,
        "secret-token",
        "https://attacker.example/reviews",
      ),
    ).rejects.toBeInstanceOf(AppStoreConnectError);
  });
});
