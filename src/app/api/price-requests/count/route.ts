import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { canApprovePriceRequests, roleFromEmployee } from "@/lib/roles";

// Lightweight count of pending price requests — polled by the mobile home
// screen to keep the approval-tab badge live without pulling the full list.
// Non-manager roles get `{ pending: 0 }` instead of 403 so the polling loop
// in the mobile client doesn't need to know the caller's role.
export async function GET(request: NextRequest) {
  const me = await getEmployeeFromRequest(request);
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canApprovePriceRequests(roleFromEmployee(me))) {
    return NextResponse.json({ pending: 0 });
  }
  const pending = await prisma.appPriceRequest.count({
    where: { status: "pending" },
  });
  return NextResponse.json({ pending });
}
