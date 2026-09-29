import { createPrivateKey, sign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AppStoreConnectConfig } from "./config";
import { logBackendWarning } from "./diagnostics";
import type { CustomerReview } from "./types";

const APP_STORE_CONNECT_ORIGIN = "https://api.appstoreconnect.apple.com";
const REVIEW_PAGE_LIMIT = 200;
const RETRY_BACKOFF_MS = [5_000, 20_000] as const;
const AUTH_RETRY_BACKOFF_MS = 2_000;
const MAX_IN_CYCLE_RETRY_AFTER_MS = 30_000;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const SAFE_APPLE_IDENTIFIER = /^[A-Za-z0-9_.-]{1,128}$/;

export interface AppStoreConnectDiagnostics {
  phase?: string;
  appleCode?: string;
  appleErrorId?: string;
  requestId?: string;
  transportType?: string;
  transportCode?: string;
  attempts?: number;
  durationMs?: number;
}

const reviewAttributesSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().max(2_000),
  body: z.string().max(10_000),
  reviewerNickname: z.string().max(2_000),
  createdDate: z
    .string()
    .max(64)
    .refine((value) => Number.isFinite(Date.parse(value)), "Invalid date"),
  territory: z.string().min(2).max(3),
});

const reviewPageSchema = z.object({
  data: z
    .array(
      z.object({
        type: z.literal("customerReviews"),
        id: z.string().min(1).max(255),
        attributes: reviewAttributesSchema,
      }),
    )
    .max(REVIEW_PAGE_LIMIT),
  links: z.object({
    next: z.string().url().optional(),
  }),
});

export interface CustomerReviewPage {
  reviews: CustomerReview[];
  nextUrl?: string;
  rateLimitRemaining?: number;
}

export class AppStoreConnectError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
    readonly diagnostics: AppStoreConnectDiagnostics = {},
  ) {
    super(message);
    this.name = "AppStoreConnectError";
  }
}

function safeAppleIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_APPLE_IDENTIFIER.test(value)
    ? value
    : undefined;
}

function transportCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  const cause =
    candidate.cause && typeof candidate.cause === "object"
      ? (candidate.cause as { code?: unknown })
      : undefined;
  return safeAppleIdentifier(cause?.code ?? candidate.code);
}

async function appleErrorMetadata(
  response: Response,
): Promise<AppStoreConnectDiagnostics> {
  const requestId = safeAppleIdentifier(
    response.headers.get("x-request-id") ??
      response.headers.get("x-apple-request-uuid"),
  );
  const metadata: AppStoreConnectDiagnostics = {
    phase: "http",
    ...(requestId ? { requestId } : {}),
  };
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_ERROR_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return metadata;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return metadata;
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) {
        break;
      }
      bytes += part.value.byteLength;
      if (bytes > MAX_ERROR_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return metadata;
      }
      chunks.push(Buffer.from(part.value));
    }
  } catch {
    return metadata;
  } finally {
    reader.releaseLock();
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      errors?: Array<{ code?: unknown; id?: unknown }>;
    };
    const first = Array.isArray(body.errors) ? body.errors[0] : undefined;
    if (first && typeof first === "object") {
      metadata.appleCode = safeAppleIdentifier(first.code);
      metadata.appleErrorId = safeAppleIdentifier(first.id);
    }
  } catch {
    // A malformed upstream error body should not replace its HTTP status.
  }
  return metadata;
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function isRetryableAppStoreConnectError(
  error: unknown,
): error is AppStoreConnectError {
  return (
    error instanceof AppStoreConnectError &&
    (error.status === undefined ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599))
  );
}

function rateLimitRemaining(header: string | null): number | undefined {
  const match = header?.match(/(?:^|;)\s*user-hour-rem:(\d+)\s*(?:;|$)/i);
  if (!match) {
    return undefined;
  }
  const remaining = Number(match[1]);
  return Number.isSafeInteger(remaining) ? remaining : undefined;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppStoreConnectToken(
  config: AppStoreConnectConfig,
  now = Date.now(),
): string {
  let key: ReturnType<typeof createPrivateKey>;
  try {
    key = createPrivateKey(config.privateKey);
  } catch {
    throw new Error("App Store Connect private key is not a valid PEM key");
  }
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("App Store Connect private key must use the P-256 curve");
  }

  const issuedAt = Math.floor(now / 1_000);
  const header = encodeJson({
    alg: "ES256",
    kid: config.keyId,
    typ: "JWT",
  });
  const payload = encodeJson({
    ...(config.keyType === "team" ? { iss: config.issuerId } : { sub: "user" }),
    iat: issuedAt,
    exp: issuedAt + 15 * 60,
    aud: "appstoreconnect-v1",
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsignedToken}.${signature.toString("base64url")}`;
}

function initialReviewUrl(appAppleId: number): string {
  const url = new URL(
    `/v1/apps/${encodeURIComponent(String(appAppleId))}/customerReviews`,
    APP_STORE_CONNECT_ORIGIN,
  );
  url.searchParams.set("limit", String(REVIEW_PAGE_LIMIT));
  url.searchParams.set("sort", "-createdDate");
  url.searchParams.set(
    "fields[customerReviews]",
    "rating,title,body,reviewerNickname,createdDate,territory",
  );
  return url.toString();
}

function validateReviewUrl(urlInput: string, appAppleId: number): URL {
  const url = new URL(urlInput);
  const expectedPath = `/v1/apps/${encodeURIComponent(
    String(appAppleId),
  )}/customerReviews`;
  if (
    url.origin !== APP_STORE_CONNECT_ORIGIN ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== expectedPath
  ) {
    throw new AppStoreConnectError(
      "App Store Connect returned an unsafe pagination URL",
      undefined,
      undefined,
      { phase: "pagination" },
    );
  }
  return url;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4 * 1024 * 1024) {
    throw new AppStoreConnectError(
      "App Store Connect response is too large",
      response.status,
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) {
    throw new AppStoreConnectError(
      "App Store Connect response is too large",
      response.status,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppStoreConnectError(
      "App Store Connect returned invalid JSON",
      response.status,
    );
  }
}

async function fetchCustomerReviewPageOnce(
  appAppleId: number,
  token: string | (() => string),
  url: URL,
  fetchImplementation: typeof fetch = fetch,
): Promise<CustomerReviewPage> {
  const bearerToken = typeof token === "string" ? token : token();
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new AppStoreConnectError(
      "App Store Connect request failed",
      undefined,
      undefined,
      {
        phase: "request",
        transportType:
          error instanceof Error ? safeAppleIdentifier(error.name) : undefined,
        transportCode: transportCode(error),
      },
    );
  }

  if (!response.ok) {
    const metadata = await appleErrorMetadata(response);
    throw new AppStoreConnectError(
      `App Store Connect rejected the request with HTTP ${response.status}`,
      response.status,
      retryAfterMs(response.headers.get("retry-after")),
      metadata,
    );
  }

  const parsed = reviewPageSchema.safeParse(await readResponseBody(response));
  if (!parsed.success) {
    throw new AppStoreConnectError(
      "App Store Connect returned an unexpected review response",
      response.status,
    );
  }
  const validatedNextUrl = parsed.data.links.next
    ? validateReviewUrl(parsed.data.links.next, appAppleId).toString()
    : undefined;
  const remaining = rateLimitRemaining(response.headers.get("x-rate-limit"));

  return {
    reviews: parsed.data.data.map((review) => ({
      id: review.id,
      ...review.attributes,
    })),
    nextUrl: validatedNextUrl,
    ...(remaining === undefined ? {} : { rateLimitRemaining: remaining }),
  };
}

export async function fetchCustomerReviewPage(
  appAppleId: number,
  token: string | (() => string),
  nextUrl?: string,
  fetchImplementation: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): Promise<CustomerReviewPage> {
  const url = validateReviewUrl(
    nextUrl ?? initialReviewUrl(appAppleId),
    appAppleId,
  );
  let transientRetries = 0;
  let authRetried = false;
  let attempts = 0;
  const startedAt = Date.now();
  while (true) {
    attempts += 1;
    try {
      return await fetchCustomerReviewPageOnce(
        appAppleId,
        token,
        url,
        fetchImplementation,
      );
    } catch (error) {
      if (
        error instanceof AppStoreConnectError &&
        error.status === 401 &&
        typeof token === "function" &&
        !authRetried
      ) {
        authRetried = true;
        logBackendWarning("app_store_review_request_retry", error, {
          appAppleId,
          attempt: attempts,
          retryInMs: AUTH_RETRY_BACKOFF_MS,
          durationMs: Date.now() - startedAt,
        });
        await wait(AUTH_RETRY_BACKOFF_MS);
        continue;
      }
      if (!isRetryableAppStoreConnectError(error) || transientRetries === 2) {
        if (error instanceof AppStoreConnectError) {
          error.diagnostics.attempts = attempts;
          error.diagnostics.durationMs = Date.now() - startedAt;
        }
        throw error;
      }
      const fallbackDelayMs = RETRY_BACKOFF_MS[transientRetries];
      transientRetries += 1;
      const requestedDelayMs = Math.max(
        fallbackDelayMs,
        error.retryAfterMs ?? 0,
      );
      if (requestedDelayMs > MAX_IN_CYCLE_RETRY_AFTER_MS) {
        error.diagnostics.attempts = attempts;
        error.diagnostics.durationMs = Date.now() - startedAt;
        throw error;
      }
      logBackendWarning("app_store_review_request_retry", error, {
        appAppleId,
        attempt: attempts,
        retryInMs: requestedDelayMs,
        durationMs: Date.now() - startedAt,
      });
      await wait(requestedDelayMs);
    }
  }
}
