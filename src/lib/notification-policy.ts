import { z } from "zod";

const paymentTypeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/);
const outboxCategorySchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const commaSeparatedValues = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .transform((value) => value.split(",").map((item) => item.trim()));

const policySchema = z.object({
  TELEGRAM_PAYMENT_NOTIFICATION_TYPES: commaSeparatedValues
    .pipe(z.array(paymentTypeSchema).min(1).max(100))
    .transform((items) => new Set(items))
    .optional(),
  TELEGRAM_PAYMENT_ENVIRONMENTS: commaSeparatedValues
    .pipe(
      z
        .array(
          z
            .string()
            .transform((value) => value.toLowerCase())
            .pipe(z.enum(["production", "sandbox"])),
        )
        .min(1)
        .max(2),
    )
    .transform((items) => new Set(items))
    .optional(),
  TELEGRAM_OUTBOX_CATEGORIES: commaSeparatedValues
    .pipe(z.array(outboxCategorySchema).min(1).max(100))
    .transform((items) => new Set(items))
    .optional(),
});

export interface TelegramNotificationPolicy {
  paymentNotificationTypes?: ReadonlySet<string>;
  paymentEnvironments?: ReadonlySet<"production" | "sandbox">;
  outboxCategories?: ReadonlySet<string>;
}

export function getTelegramNotificationPolicy(): TelegramNotificationPolicy {
  const parsed = policySchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Telegram notification policy is invalid: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }
  return {
    paymentNotificationTypes: parsed.data.TELEGRAM_PAYMENT_NOTIFICATION_TYPES,
    paymentEnvironments: parsed.data.TELEGRAM_PAYMENT_ENVIRONMENTS,
    outboxCategories: parsed.data.TELEGRAM_OUTBOX_CATEGORIES,
  };
}

export function shouldSendPaymentNotification(input: {
  notificationType: string;
  environment: string;
}): boolean {
  const policy = getTelegramNotificationPolicy();
  return (
    (!policy.paymentNotificationTypes ||
      policy.paymentNotificationTypes.has(input.notificationType)) &&
    (!policy.paymentEnvironments ||
      policy.paymentEnvironments.has(
        input.environment.toLowerCase() as "production" | "sandbox",
      ))
  );
}

export function shouldSendOutboxNotification(category: string): boolean {
  const categories = getTelegramNotificationPolicy().outboxCategories;
  return !categories || categories.has(category);
}
