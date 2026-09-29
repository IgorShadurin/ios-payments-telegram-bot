import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/database";
import { logBackendFailure } from "@/lib/diagnostics";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": "Bearer",
      },
    },
  );
}

export function GET(request: Request) {
  const startedAt = Date.now();
  try {
    if (!isAdminRequestAuthorized(request)) {
      return unauthorized();
    }
    return NextResponse.json(
      {
        apps: getDatabase()
          .listApps()
          .map((app) => ({
            name: app.name,
            bundleId: app.bundleId,
            appAppleId: app.appAppleId,
            enabled: app.enabled,
          })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const errorId = logBackendFailure("admin_apps_read_failed", error, {
      route: "admin/apps",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Admin API is unavailable", errorId },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
