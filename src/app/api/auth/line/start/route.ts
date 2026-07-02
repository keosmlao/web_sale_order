import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { lineCallbackUrl, linePublicOrigin, lineChannelId, lineLoginConfigured, randomState } from "@/lib/line";

// Kick off LINE Login: remember a CSRF state in a short-lived cookie and
// send the user to LINE's authorize page. Callback lands on
// /api/auth/line/callback.
export async function GET(request: NextRequest) {
  if (!lineLoginConfigured()) {
    return NextResponse.redirect(new URL("/login?error=line", linePublicOrigin(request.nextUrl.origin)));
  }

  const state = randomState();
  const redirectUri = lineCallbackUrl(request.nextUrl.origin);

  const authorize = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", lineChannelId());
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "profile openid");

  const res = NextResponse.redirect(authorize);
  res.cookies.set("line_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return res;
}
