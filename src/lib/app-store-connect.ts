import { createPrivateKey, sign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { AppStoreConnectConfig } from "./config";
import type { CustomerReview } from "./types";

const APP_STORE_CONNECT_ORIGIN = "https://api.appstoreconnect.apple.com";
const REVIEW_PAGE_LIMIT = 200;

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
}

export class AppStoreConnectError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AppStoreConnectError";
  }
}

function retryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 10_000);
  }
  const date = Date.parse(header);
  return Number.isFinite(date)
    ? Math.min(Math.max(0, date - Date.now()), 10_000)
    : undefined;
}

function isRetryable(error: unknown): error is AppStoreConnectError {
  return (
    error instanceof AppStoreConnectError &&
    (error.status === undefined ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599))
  );
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
  token: string,
  url: URL,
  fetchImplementation: typeof fetch = fetch,
): Promise<CustomerReviewPage> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppStoreConnectError("App Store Connect request failed");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AppStoreConnectError(
      `App Store Connect rejected the request with HTTP ${response.status}`,
      response.status,
      retryAfterMs(response.headers.get("retry-after")),
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

  return {
    reviews: parsed.data.data.map((review) => ({
      id: review.id,
      ...review.attributes,
    })),
    nextUrl: validatedNextUrl,
  };
}

export async function fetchCustomerReviewPage(
  appAppleId: number,
  token: string,
  nextUrl?: string,
  fetchImplementation: typeof fetch = fetch,
  wait: (milliseconds: number) => Promise<unknown> = delay,
): Promise<CustomerReviewPage> {
  const url = validateReviewUrl(
    nextUrl ?? initialReviewUrl(appAppleId),
    appAppleId,
  );
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fetchCustomerReviewPageOnce(
        appAppleId,
        token,
        url,
        fetchImplementation,
      );
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) {
        throw error;
      }
      await wait(error.retryAfterMs ?? [500, 1_500][attempt]);
    }
  }
  throw lastError;
}
