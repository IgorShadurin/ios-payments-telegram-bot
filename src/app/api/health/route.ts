import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";
import { logBackendFailure } from "@/lib/diagnostics";

export const runtime = "nodejs";

export function GET() {
  const startedAt = Date.now();
  try {
    const database = getDatabase();
    database.healthCheck();
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    const errorId = logBackendFailure("health_check_failed", error, {
      route: "health",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json({ status: "error", errorId }, { status: 503 });
  }
}
