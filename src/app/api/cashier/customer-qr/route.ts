import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { buildDynamicQr } from "@/lib/lao-qr";

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

  const base = (process.env.BCEL_QR_PAYLOAD ?? "").trim();
  if (!base) {
    // Not configured yet — the display shows a "paste your BCEL QR" hint.
    return NextResponse.json({ configured: false, payload: null });
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
