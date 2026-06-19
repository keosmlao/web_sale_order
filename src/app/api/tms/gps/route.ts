import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/tms/gps
//
// Latest known position of each delivery truck (odg_tms_gps_current) for the
// live map on the delivery-tracking page. Only rows with usable coordinates.
type GpsRow = {
  car_code: string | null;
  car_name: string | null;
  lat: string | null;
  lng: string | null;
  speed: string | number | null;
  engine_state: string | null;
  recorded_at: string | null;
  address: string | null;
};

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await prisma.$queryRaw<GpsRow[]>`
    SELECT car_code, car_name, lat, lng, speed, engine_state, recorded_at, address
    FROM odg_tms_gps_current
    WHERE lat IS NOT NULL AND lat <> '' AND lng IS NOT NULL AND lng <> ''
  `;

  const trucks = rows
    .map((r) => ({
      carCode: r.car_code,
      carName: r.car_name?.trim() || r.car_code || "—",
      lat: Number(r.lat),
      lng: Number(r.lng),
      speed: r.speed == null ? null : Number(r.speed),
      engineState: r.engine_state?.trim() || null,
      recordedAt: r.recorded_at?.trim() || null,
      address: r.address?.trim() || null,
    }))
    .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng) && t.lat !== 0);

  return NextResponse.json({ trucks });
}
