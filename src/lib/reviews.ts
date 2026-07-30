import type { AppDatabase } from "./database";
import { escapeTelegramHtml } from "./message";
import type {
  CustomerReview,
  CustomerReviewWithMessage,
  RegisteredApp,
} from "./types";

const MAX_PAGES_PER_APP = 5;

function truncate(value: string, length: number): string {
  const characters = [...value.trim()];
  return characters.length <= length
    ? characters.join("")
    : `${characters.slice(0, length - 1).join("")}…`;
}

function formatReviewDate(value: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

export function formatCustomerReviewMessage(
  app: RegisteredApp,
  review: CustomerReview,
): string {
  const stars = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}`;
  const lines = [
    "<b>⭐ New App Store review</b>",
    `<b>App:</b> ${escapeTelegramHtml(app.name)} (${escapeTelegramHtml(
      app.bundleId,
    )})`,
    `<b>Rating:</b> ${stars} (${review.rating}/5)`,
  ];
  const title = truncate(review.title, 300);
  if (title) {
    lines.push(`<b>Title:</b> ${escapeTelegramHtml(title)}`);
  }
  const body = truncate(review.body, 2_500);
  if (body) {
    lines.push(`<b>Review:</b> ${escapeTelegramHtml(body)}`);
  }
  const reviewer = truncate(review.reviewerNickname, 200);
  if (reviewer) {
    lines.push(`<b>Reviewer:</b> ${escapeTelegramHtml(reviewer)}`);
  }
  lines.push(
    `<b>Territory:</b> ${escapeTelegramHtml(review.territory)}`,
    `<b>Created:</b> ${escapeTelegramHtml(
      formatReviewDate(review.createdDate),
    )}`,
  );
  return lines.join("\n");
}

export type ReviewPageFetcher = (
  appAppleId: number,
  nextUrl?: string,
) => Promise<{ reviews: CustomerReview[]; nextUrl?: string }>;

export interface ReviewPollResult {
  apps: number;
  baselineApps: number;
  stored: number;
  queued: number;
  failed: number;
}

export async function pollCustomerReviews(
  database: AppDatabase,
  fetchPage: ReviewPageFetcher,
  onError: (app: RegisteredApp, error: unknown) => void = () => undefined,
): Promise<ReviewPollResult> {
  const apps = database.listApps(false);
  const result: ReviewPollResult = {
    apps: apps.length,
    baselineApps: 0,
    stored: 0,
    queued: 0,
    failed: 0,
  };

  for (const app of apps) {
    let nextUrl: string | undefined;
    try {
      for (
        let pageNumber = 0;
        pageNumber < MAX_PAGES_PER_APP;
        pageNumber += 1
      ) {
        const page = await fetchPage(app.appAppleId, nextUrl);
        const hadKnownReview = page.reviews.some((review) =>
          database.getCustomerReview(review.id),
        );
        const reviewsWithMessages: CustomerReviewWithMessage[] =
          page.reviews.map((review) => ({
            ...review,
            messageHtml: formatCustomerReviewMessage(app, review),
          }));
        const stored = database.storeCustomerReviewBatch(
          app.id,
          reviewsWithMessages,
        );
        if (stored.baselineCreated) {
          result.baselineApps += 1;
        }
        result.stored += stored.stored;
        result.queued += stored.queued;

        nextUrl = page.nextUrl;
        if (
          stored.baselineCreated ||
          hadKnownReview ||
          !nextUrl ||
          page.reviews.length === 0
        ) {
          break;
        }
      }
    } catch (error) {
      result.failed += 1;
      onError(app, error);
    }
  }

  return result;
}
