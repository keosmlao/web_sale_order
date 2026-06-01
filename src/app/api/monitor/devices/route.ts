import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canMonitorDevices, roleFromEmployee } from "@/lib/roles";

// Supervisory feed for the /monitor dashboard: every salesperson's phone
// presence + device telemetry + last known location. Heads and managers
// only. A device is reported "online" when its last_seen_at is newer than
// ONLINE_THRESHOLD_MS — because the app only pings on activity, a phone that
// hasn't reported within the window has gone idle / background / offline.
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canMonitorDevices(roleFromEmployee(me))) {
    return NextResponse.json(
      { error: "ສະເພາະຫົວໜ້າ ແລະ ຜູ້ຈັດການເທົ່ານັ້ນ" },
      { status: 403 },
    );
  }

  const rows = await prisma.appDevicePresence.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 500,
  });

  // Resolve display names in one query rather than N joins.
  const codes = rows.map((r) => r.employeeCode);
  const employees = codes.length
    ? await prisma.odgEmployee.findMany({
        where: { employeeCode: { in: codes } },
        select: {
          employeeCode: true,
          fullnameLo: true,
          fullnameEn: true,
          nickname: true,
          positionCode: true,
          appRole: true,
        },
      })
    : [];
  const empByCode = new Map(employees.map((e) => [e.employeeCode, e]));

  const nowMs = Date.now();
  const devices = rows.map((r) => {
    const emp = empByCode.get(r.employeeCode);
    const lastSeenMs = r.lastSeenAt.getTime();
    const online = r.online && nowMs - lastSeenMs <= ONLINE_THRESHOLD_MS;
    return {
      employeeCode: r.employeeCode,
      name:
        emp?.fullnameLo?.trim() ||
        emp?.nickname?.trim() ||
        emp?.fullnameEn?.trim() ||
        r.employeeCode,
      role: emp ? roleFromEmployee(emp) : null,
      online,
      lastSeenAt: r.lastSeenAt,
      secondsSinceSeen: Math.max(0, Math.round((nowMs - lastSeenMs) / 1000)),
      platform: r.platform,
      appVersion: r.appVersion,
      deviceModel: r.deviceModel,
      osVersion: r.osVersion,
      batteryPct: r.batteryPct,
      charging: r.charging,
      currentScreen: r.currentScreen,
      lat: r.lat,
      lng: r.lng,
      locationAt: r.locationAt,
    };
  });

  const onlineCount = devices.filter((d) => d.online).length;

  return NextResponse.json({
    serverTime: new Date().toISOString(),
    onlineThresholdSeconds: ONLINE_THRESHOLD_MS / 1000,
    onlineCount,
    total: devices.length,
    devices,
  });
}
