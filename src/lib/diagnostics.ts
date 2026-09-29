import { randomUUID } from "node:crypto";

export interface DiagnosticContext {
  task?: string;
  route?: string;
  phase?: string;
  reason?: string;
  appBundleId?: string;
  appAppleId?: number;
  attemptedApps?: number;
  page?: number;
  itemId?: number;
  category?: string;
  durationMs?: number;
  attempt?: number;
  retryInMs?: number;
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]{1,128}$/;
const SAFE_LABEL = /^[a-z0-9_./-]{1,128}$/;

function safeString(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : undefined;
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeLocation(error: Error): string | undefined {
  for (const frame of error.stack?.split("\n").slice(1, 8) ?? []) {
    const match = frame.match(
      /(?:\/|\\)(src|scripts|dist)(?:\/|\\)([A-Za-z0-9_./-]+):(\d+):(\d+)\)?$/,
    );
    if (match) {
      return `${match[1]}/${match[2].replaceAll("\\", "/")}:${match[3]}:${match[4]}`;
    }
  }
  return undefined;
}

function errorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { errorType: "UnknownError" };
  }
  const typed = error as Error & {
    code?: unknown;
    status?: unknown;
    retryAfterMs?: unknown;
    retryAfterSeconds?: unknown;
    diagnostics?: unknown;
    cause?: unknown;
  };
  const diagnostics =
    typed.diagnostics && typeof typed.diagnostics === "object"
      ? (typed.diagnostics as Record<string, unknown>)
      : {};
  const cause =
    typed.cause && typeof typed.cause === "object"
      ? (typed.cause as Record<string, unknown>)
      : {};

  return {
    errorType: safeString(error.name, SAFE_IDENTIFIER) ?? "Error",
    ...(safeLocation(error) ? { location: safeLocation(error) } : {}),
    ...(safeNumber(typed.status) !== undefined
      ? { status: safeNumber(typed.status) }
      : {}),
    ...(safeString(typed.code, SAFE_IDENTIFIER)
      ? { errorCode: safeString(typed.code, SAFE_IDENTIFIER) }
      : {}),
    ...(safeNumber(typed.retryAfterMs) !== undefined
      ? { retryAfterMs: safeNumber(typed.retryAfterMs) }
      : {}),
    ...(safeNumber(typed.retryAfterSeconds) !== undefined
      ? { retryAfterSeconds: safeNumber(typed.retryAfterSeconds) }
      : {}),
    ...(safeString(cause.code, SAFE_IDENTIFIER)
      ? { causeCode: safeString(cause.code, SAFE_IDENTIFIER) }
      : {}),
    ...(safeString(diagnostics.phase, SAFE_LABEL)
      ? { upstreamPhase: safeString(diagnostics.phase, SAFE_LABEL) }
      : {}),
    ...(safeString(diagnostics.appleCode, SAFE_IDENTIFIER)
      ? { appleCode: safeString(diagnostics.appleCode, SAFE_IDENTIFIER) }
      : {}),
    ...(safeString(diagnostics.appleErrorId, SAFE_IDENTIFIER)
      ? { appleErrorId: safeString(diagnostics.appleErrorId, SAFE_IDENTIFIER) }
      : {}),
    ...(safeString(diagnostics.requestId, SAFE_IDENTIFIER)
      ? {
          upstreamRequestId: safeString(diagnostics.requestId, SAFE_IDENTIFIER),
        }
      : {}),
    ...(safeString(diagnostics.transportCode, SAFE_IDENTIFIER)
      ? {
          transportCode: safeString(diagnostics.transportCode, SAFE_IDENTIFIER),
        }
      : {}),
    ...(safeString(diagnostics.transportType, SAFE_IDENTIFIER)
      ? {
          transportType: safeString(diagnostics.transportType, SAFE_IDENTIFIER),
        }
      : {}),
    ...(safeNumber(diagnostics.attempts) !== undefined
      ? { upstreamAttempts: safeNumber(diagnostics.attempts) }
      : {}),
    ...(safeNumber(diagnostics.durationMs) !== undefined
      ? { upstreamDurationMs: safeNumber(diagnostics.durationMs) }
      : {}),
  };
}

function contextFields(context: DiagnosticContext): Record<string, unknown> {
  return {
    ...(safeString(context.task, SAFE_LABEL) ? { task: context.task } : {}),
    ...(safeString(context.route, SAFE_LABEL) ? { route: context.route } : {}),
    ...(safeString(context.phase, SAFE_LABEL) ? { phase: context.phase } : {}),
    ...(safeString(context.reason, SAFE_LABEL)
      ? { reason: context.reason }
      : {}),
    ...(safeString(context.appBundleId, SAFE_IDENTIFIER)
      ? { appBundleId: context.appBundleId }
      : {}),
    ...(safeNumber(context.appAppleId) !== undefined
      ? { appAppleId: context.appAppleId }
      : {}),
    ...(safeNumber(context.attemptedApps) !== undefined
      ? { attemptedApps: context.attemptedApps }
      : {}),
    ...(safeNumber(context.page) !== undefined ? { page: context.page } : {}),
    ...(safeNumber(context.itemId) !== undefined
      ? { itemId: context.itemId }
      : {}),
    ...(safeString(context.category, SAFE_LABEL)
      ? { category: context.category }
      : {}),
    ...(safeNumber(context.durationMs) !== undefined
      ? { durationMs: context.durationMs }
      : {}),
    ...(safeNumber(context.attempt) !== undefined
      ? { attempt: context.attempt }
      : {}),
    ...(safeNumber(context.retryInMs) !== undefined
      ? { retryInMs: context.retryInMs }
      : {}),
  };
}

export function logBackendFailure(
  event: string,
  error: unknown,
  context: DiagnosticContext = {},
): string {
  const diagnosticId = randomUUID();
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: safeString(event, SAFE_LABEL) ?? "backend_error",
      diagnosticId,
      ...contextFields(context),
      ...errorFields(error),
    }),
  );
  return diagnosticId;
}

export function logBackendWarning(
  event: string,
  error: unknown,
  context: DiagnosticContext = {},
): void {
  console.warn(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event: safeString(event, SAFE_LABEL) ?? "backend_warning",
      ...contextFields(context),
      ...(error === undefined ? {} : errorFields(error)),
    }),
  );
}
