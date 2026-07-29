import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/database";

export const runtime = "nodejs";

export function GET() {
  try {
    const database = getDatabase();
    database.healthCheck();
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
