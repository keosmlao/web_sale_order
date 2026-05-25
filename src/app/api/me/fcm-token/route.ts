import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Mobile clients call this on login (and on FCM token-refresh) so the
// server knows where to deliver notifications. Upsert keyed on token so the
// same physical device re-logging in just updates owner + last_seen.

const ALLOWED_PLATFORMS = new Set(["android", "ios", "web"]);

export async function POST(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
    platform?: unknown;
  } | null;
  const token =
    typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }
  const platformRaw =
    typeof body?.platform === "string" ? body.platform.trim().toLowerCase() : "";
  const platform = ALLOWED_PLATFORMS.has(platformRaw) ? platformRaw : null;

  await prisma.appFcmToken.upsert({
    where: { token },
    create: {
      token,
      employeeCode: me.employeeCode,
      platform,
    },
    update: {
      employeeCode: me.employeeCode,
      platform,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

// Called on logout. Best-effort — return ok even if the token wasn't known.
export async function DELETE(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    token?: unknown;
  } | null;
  const token =
    typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ ok: true });
  }
  await prisma.appFcmToken.deleteMany({ where: { token } });
  return NextResponse.json({ ok: true });
}
