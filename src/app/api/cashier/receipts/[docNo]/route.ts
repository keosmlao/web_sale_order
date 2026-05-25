import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { fetchReceipt } from "@/lib/receipts";

type RouteContext = {
  params: Promise<{ docNo: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { docNo: rawDocNo } = await context.params;
  const docNo = rawDocNo.trim();
  if (!docNo) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸເລກໃບຮັບເງິນ" },
      { status: 400 },
    );
  }

  const receipt = await fetchReceipt(docNo);
  if (!receipt) {
    return NextResponse.json(
      { error: `ບໍ່ພົບໃບຮັບເງິນ ${docNo}` },
      { status: 404 },
    );
  }
  return NextResponse.json(receipt);
}
