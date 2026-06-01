import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// The sales mobile app posts here on activity — login, app resume, screen
// change — to report presence + device telemetry. One row per employee,
// upserted (the latest device to report wins). Never called on a background
// timer; "online" is derived downstream from last_seen_at freshness.
//
// Body (all optional except it must be authenticated):
//   online        boolean   false when the app is pausing / logging out
//   platform      string    android | ios | web
//   appVersion    string
//   deviceModel   string
//   osVersion     string
//   batteryPct    number    0..100
//   charging      boolean
//   currentScreen string    label of the screen the user is on
//   lat, lng      number    last known GPS fix (only when active + permitted)
//   deviceId      string    stable per-install id (e.g. FCM token)

const ALLOWED_PLATFORMS = new Set(["android", "ios", "web"]);

function asStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

export async function POST(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me?.employeeCode) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const platformRaw = asStr(body.platform, 10)?.toLowerCase() ?? null;
  const platform =
    platformRaw && ALLOWED_PLATFORMS.has(platformRaw) ? platformRaw : null;

  const online = asBool(body.online) ?? true;

  const battery = asNum(body.batteryPct);
  const batteryPct =
    battery == null ? null : Math.max(0, Math.min(100, Math.round(battery)));

  const lat = asNum(body.lat);
  const lng = asNum(body.lng);
  const hasFix =
    lat != null &&
    lng != null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  const now = new Date();
  const appVersion = asStr(body.appVersion, 40);
  const deviceModel = asStr(body.deviceModel, 160);
  const osVersion = asStr(body.osVersion, 60);
  const currentScreen = asStr(body.currentScreen, 80);
  const charging = asBool(body.charging);
  const deviceId = asStr(body.deviceId, 200);

  // Location columns are only overwritten when this report carries a fresh
  // fix — a screen-change ping with no GPS keeps the previous coordinates.
  const locationPatch = hasFix
    ? { lat, lng, locationAt: now }
    : {};

  await prisma.appDevicePresence.upsert({
    where: { employeeCode: me.employeeCode },
    create: {
      employeeCode: me.employeeCode,
      online,
      lastSeenAt: now,
      platform,
      appVersion,
      deviceModel,
      osVersion,
      batteryPct,
      charging,
      currentScreen,
      deviceId,
      ...(hasFix ? { lat, lng, locationAt: now } : {}),
    },
    update: {
      online,
      lastSeenAt: now,
      // Only overwrite a telemetry field when this report actually carries
      // it, so a lightweight ping doesn't wipe richer data from a previous
      // report.
      ...(platform != null ? { platform } : {}),
      ...(appVersion != null ? { appVersion } : {}),
      ...(deviceModel != null ? { deviceModel } : {}),
      ...(osVersion != null ? { osVersion } : {}),
      ...(batteryPct != null ? { batteryPct } : {}),
      ...(charging != null ? { charging } : {}),
      ...(currentScreen != null ? { currentScreen } : {}),
      ...(deviceId != null ? { deviceId } : {}),
      ...locationPatch,
    },
  });

  return NextResponse.json({ ok: true });
}
