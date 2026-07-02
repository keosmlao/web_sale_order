import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import {
  lineCallbackUrl,
  lineChannelId,
  lineChannelSecret,
  lineLoginConfigured,
  signPayload,
} from "@/lib/line";

// LINE Login callback: verify state, swap the code for an access token, read
// the LINE profile, then either sign the linked employee in or hand off to
// the one-time link page (/login/link-line).
export async function GET(request: NextRequest) {
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));

  if (!lineLoginConfigured()) return fail("line");

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const cookieState = request.cookies.get("line_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return fail("line-state");
  }

  const redirectUri = lineCallbackUrl(request.nextUrl.origin);

  try {
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: lineChannelId(),
        client_secret: lineChannelSecret(),
      }),
    });
    if (!tokenRes.ok) return fail("line-token");
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return fail("line-token");

    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileRes.ok) return fail("line-profile");
    const profile = (await profileRes.json()) as {
      userId?: string;
      displayName?: string;
    };
    if (!profile.userId) return fail("line-profile");

    // Match the LINE user straight against the roster: odg_employee.line_id
    // already holds LINE userIds (collected via the shop's LINE OA — works
    // because the Login channel lives under the same provider). Fall back to
    // app_employee_line for accounts linked through the app itself.
    const linked = await prisma.$queryRaw<Array<{ employee_code: string; employment_status: string | null }>>`
      SELECT q.employee_code, e.employment_status
      FROM (
        SELECT employee_code, 0 AS pr FROM odg_employee
          WHERE line_id = ${profile.userId}
        UNION ALL
        SELECT employee_code, 1 FROM app_employee_line
          WHERE line_user_id = ${profile.userId}
      ) q
      JOIN odg_employee e ON e.employee_code = q.employee_code
      ORDER BY q.pr
      LIMIT 1
    `;
    if (
      linked[0] &&
      linked[0].employment_status &&
      linked[0].employment_status !== "ACTIVE"
    ) {
      return fail("line-inactive");
    }
    const employeeCode = linked[0]?.employee_code;
    if (employeeCode) {
      const roleRows = await prisma.$queryRaw<Array<{ app_role: string | null }>>`
        SELECT app_role FROM app_employee_access
        WHERE employee_code = ${employeeCode} AND is_active = true
        LIMIT 1
      `;
      const role = roleRows[0]?.app_role?.trim().toLowerCase();
      const dest = role === "pc" || role === "salesperson" ? "/orders/new" : "/";
      const res = NextResponse.redirect(new URL(dest, request.url));
      res.cookies.set(SESSION_COOKIE_NAME, createSessionToken(employeeCode), {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: 60 * 60 * 8,
        path: "/",
      });
      res.cookies.delete("line_oauth_state");
      return res;
    }

    // Not linked yet → back to the normal login page; a successful normal
    // login while the pending cookie is set links this LINE account
    // automatically (see loginAction). No extra screen.
    const res = NextResponse.redirect(new URL("/login?line=link", request.url));
    res.cookies.set(
      "line_link_pending",
      signPayload(
        { lineUserId: profile.userId, displayName: profile.displayName ?? "" },
        600,
      ),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: 600,
        path: "/",
      },
    );
    res.cookies.delete("line_oauth_state");
    return res;
  } catch {
    return fail("line");
  }
}
