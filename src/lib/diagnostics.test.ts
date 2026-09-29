import { afterEach, describe, expect, it, vi } from "vitest";
import { logBackendFailure, logBackendWarning } from "./diagnostics";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend diagnostics", () => {
  it("logs useful error fields without raw messages or unapproved context", () => {
    const write = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const error = new Error("private review text and secret-token") as Error & {
      status: number;
      diagnostics: Record<string, unknown>;
    };
    error.name = "AppStoreConnectError";
    error.status = 401;
    error.diagnostics = {
      phase: "http",
      appleCode: "NOT_AUTHORIZED",
      appleErrorId: "123e4567-e89b-12d3-a456-426614174000",
      requestId: "req-123",
      attempts: 2,
      durationMs: 2110,
      rawBody: "secret-token",
    };

    const errorId = logBackendFailure("review_poll_app_failed", error, {
      task: "reviews",
      appBundleId: "com.example.app",
      appAppleId: 123456789,
      attemptedApps: 13,
      page: 2,
      durationMs: 4500,
    });

    const line = write.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      event: "review_poll_app_failed",
      diagnosticId: errorId,
      task: "reviews",
      appBundleId: "com.example.app",
      appAppleId: 123456789,
      attemptedApps: 13,
      page: 2,
      durationMs: 4500,
      errorType: "AppStoreConnectError",
      status: 401,
      upstreamPhase: "http",
      appleCode: "NOT_AUTHORIZED",
      appleErrorId: "123e4567-e89b-12d3-a456-426614174000",
      upstreamRequestId: "req-123",
      upstreamAttempts: 2,
      upstreamDurationMs: 2110,
    });
    expect(line).not.toContain("private review text");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("rawBody");
  });

  it("drops unsafe upstream identifiers from retry warnings", () => {
    const write = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new Error("secret") as Error & {
      diagnostics: Record<string, unknown>;
    };
    error.diagnostics = {
      appleCode: "something with private data",
      requestId: "https://example.com/token=secret",
    };

    logBackendWarning("app_store_review_request_retry", error, {
      appAppleId: 123456789,
      attempt: 1,
      retryInMs: 2000,
    });

    const line = write.mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      event: "app_store_review_request_retry",
      appAppleId: 123456789,
      attempt: 1,
      retryInMs: 2000,
    });
    expect(line).not.toContain("private data");
    expect(line).not.toContain("token=secret");
  });
});
