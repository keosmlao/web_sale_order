import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/cashier/onepay-config
//
// Exposes the (non-secret) OnePay merchant id + shop code so the cashier client
// can subscribe to the BCEL OnePay PubNub channel and auto-confirm a bill the
// moment the customer's transfer lands. MCID/shopcode are already embedded in
// the merchant QR the customer scans, so they are not sensitive. The PubNub
// username/password/account remain server-only.
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const mcid = (process.env.ONEPAY_MCID ?? "").trim();
  const shopcode = (process.env.ONEPAY_SHOPCODE ?? "").trim();
  if (!mcid) {
    return NextResponse.json({ configured: false });
  }
  return NextResponse.json({
    configured: true,
    mcid,
    shopcode: shopcode || null,
  });
}
