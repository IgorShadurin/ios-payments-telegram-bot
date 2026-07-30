import { afterEach, describe, expect, it } from "vitest";
import { isAdminRequestAuthorized } from "./admin-auth";

afterEach(() => {
  delete process.env.IOS_PAYMENTS_ADMIN_API_KEY;
});

describe("admin API authentication", () => {
  it("accepts only the exact configured bearer key", () => {
    const key = "a".repeat(64);
    process.env.IOS_PAYMENTS_ADMIN_API_KEY = key;

    expect(
      isAdminRequestAuthorized(
        new Request("https://example.test", {
          headers: { authorization: `Bearer ${key}` },
        }),
      ),
    ).toBe(true);
    expect(
      isAdminRequestAuthorized(
        new Request("https://example.test", {
          headers: { authorization: `Bearer ${"b".repeat(64)}` },
        }),
      ),
    ).toBe(false);
    expect(isAdminRequestAuthorized(new Request("https://example.test"))).toBe(
      false,
    );
  });

  it("rejects an unsafe server-side key configuration", () => {
    process.env.IOS_PAYMENTS_ADMIN_API_KEY = "short";
    expect(() =>
      isAdminRequestAuthorized(new Request("https://example.test")),
    ).toThrow("not configured safely");
  });
});
