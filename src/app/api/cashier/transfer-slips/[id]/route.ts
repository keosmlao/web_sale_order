import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const slipId = BigInt(rawId.trim());

  const slip = await prisma.appTransferSlip.findUnique({
    where: { id: slipId },
    select: { imageData: true, mimeType: true, fileName: true },
  });
  if (!slip) {
    return NextResponse.json(
      { error: "ບໍ່ພົບຮູບແນບ" },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(slip.imageData), {
    status: 200,
    headers: {
      "Content-Type": slip.mimeType,
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${slip.fileName ?? `slip-${rawId}`}"`,
    },
  });
}
