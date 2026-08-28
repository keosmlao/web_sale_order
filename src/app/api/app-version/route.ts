import { NextResponse } from "next/server";
import { APP_RELEASE } from "@/lib/app-release";

// Deliberately unauthenticated: the app asks before anyone has logged in,
// and a build too old to talk to this server must still be told so.
export async function GET() {
  return NextResponse.json(APP_RELEASE, {
    headers: { "Cache-Control": "no-store" },
  });
}
