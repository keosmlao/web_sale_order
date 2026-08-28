import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { getHomeDashboard } from "@/lib/home-dashboard";
import { roleFromEmployee } from "@/lib/roles";

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

  // A head or a manager is accountable for the floor, so their figures are
  // the floor's — the same call the web home page makes for them. Deciding
  // this differently on the two surfaces would hand exactly the people who
  // keep both open two different numbers.
  const role = roleFromEmployee(me);
  const scope = role === "manager" || role === "head" ? "team" : "me";
  const data = await getHomeDashboard(code, me.departmentCode ?? "", scope);
  return NextResponse.json(
    {
      // Named so the app never has to guess what the figures are in.
      currency: "THB",
      scope,
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
