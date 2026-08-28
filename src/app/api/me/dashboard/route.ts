import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getHomeDashboard } from "@/lib/home-dashboard";

// What the Android app's home screen renders — the same figures, from the
// same function, as the web home page. See src/lib/home-dashboard.ts for
// why that matters: the two used to disagree about the same person's day.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const code = me.employeeCode ?? "";
  if (!code) {
    return NextResponse.json({ error: "ບໍ່ມີລະຫັດພະນັກງານ" }, { status: 400 });
  }

  const data = await getHomeDashboard(code, me.departmentCode ?? "");
  return NextResponse.json(
    {
      // Named so the app never has to guess what the figures are in.
      currency: "THB",
      employee: {
        code,
        name: me.fullnameLo ?? me.nickname ?? code,
        departmentCode: me.departmentCode ?? "",
      },
      ...data,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
