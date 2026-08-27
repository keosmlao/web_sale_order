import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { APP_BETA, APP_RELEASE } from "@/lib/app-release";

// Deliberately unauthenticated: the app asks before anyone has logged in,
// and a build too old to talk to this server must still be told so.
//
// `?channel=beta` returns the beta manifest — same shape, so anything
// reading this endpoint works against either channel unchanged.
export async function GET(request: NextRequest) {
  const beta = request.nextUrl.searchParams.get("channel") === "beta";
  return NextResponse.json(beta ? APP_BETA : APP_RELEASE, {
    headers: { "Cache-Control": "no-store" },
  });
}
