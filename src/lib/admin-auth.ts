import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const adminApiKeySchema = z
  .string()
  .min(32)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/);

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function getAdminApiKey(): string {
  const parsed = adminApiKeySchema.safeParse(
    process.env.IOS_PAYMENTS_ADMIN_API_KEY?.trim(),
  );
  if (!parsed.success) {
    throw new Error("IOS_PAYMENTS_ADMIN_API_KEY is not configured safely");
  }
  return parsed.data;
}

export function isAdminRequestAuthorized(request: Request): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~-]{32,200})$/.exec(authorization);
  const supplied = match?.[1] ?? "";
  const expected = getAdminApiKey();
  return timingSafeEqual(digest(supplied), digest(expected));
}
