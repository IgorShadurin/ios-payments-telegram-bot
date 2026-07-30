import { NextResponse } from "next/server";
import { isAdminRequestAuthorized } from "@/lib/admin-auth";
import { getDatabase } from "@/lib/database";

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
  } catch {
    return NextResponse.json(
      { error: "Admin API is unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
