import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { buildDynamicQr, buildOnePayStaticQr } from "@/lib/lao-qr";

// GET /api/cashier/customer-qr?amount=250000
//
// Returns an amount-bearing BCEL One (Lao QR) payload built from the merchant's
// static base QR. The base lives in BCEL_QR_PAYLOAD (server env) so the
// merchant string never ships to the client; only the per-bill dynamic payload
// (which a customer would scan anyway) is returned.
export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let base = (process.env.BCEL_QR_PAYLOAD ?? "").trim();
  if (!base) {
    const mcid = (process.env.ONEPAY_MCID ?? "").trim();
    const merchantName = (process.env.ONEPAY_MERCHANT_NAME ?? "").trim();
    const mcc = (process.env.ONEPAY_MCC ?? "").trim();
    if (!mcid || !merchantName || !mcc) {
      return NextResponse.json({ configured: false, payload: null });
    }
    base = buildOnePayStaticQr({
      mcid,
      merchantName,
      mcc,
      provinceCode: process.env.ONEPAY_PROVINCE_CODE,
    });
  }

  const amount = Number(request.nextUrl.searchParams.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const payload = buildDynamicQr(base, amount);
    return NextResponse.json({ configured: true, payload });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "QR build failed" },
      { status: 500 },
    );
  }
}
