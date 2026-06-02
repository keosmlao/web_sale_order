import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { getEmployeeFromRequest } from "@/lib/auth";

// /api/qrcode?text=<data>&size=<px>
//
// Returns an SVG QR code for the given text. Used by the price-tag generator
// so each tag can embed a scannable QR (e.g. a shop link / @odgplus) via a
// plain <img src="/api/qrcode?text=..."> — generation stays on the server,
// reusing the same `qrcode` package already used by /download.

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const text = request.nextUrl.searchParams.get("text")?.trim();
  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }
  const sizeParam = Number(request.nextUrl.searchParams.get("size") ?? 160);
  const size = Number.isFinite(sizeParam)
    ? Math.min(Math.max(Math.round(sizeParam), 64), 512)
    : 160;

  const svg = await QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: size,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Same text always renders the same QR — let the browser cache it.
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
