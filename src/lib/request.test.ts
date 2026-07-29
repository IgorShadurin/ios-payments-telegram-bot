import { describe, expect, it } from "vitest";
import { readJsonBody } from "./request";

describe("readJsonBody", () => {
  it("reads an application/json request", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ signedPayload: "abc" }),
    });
    await expect(readJsonBody(request)).resolves.toEqual({
      signedPayload: "abc",
    });
  });

  it("rejects non-JSON content", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    await expect(readJsonBody(request)).rejects.toMatchObject({ status: 415 });
  });

  it("stops reading after the configured byte limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "too large" }),
    });
    await expect(readJsonBody(request, 4)).rejects.toMatchObject({
      status: 413,
    });
  });
});
