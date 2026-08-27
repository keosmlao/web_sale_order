import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// Product photo for the POS catalogue.
//
// The pictures were already taken — the storefront's own online shop has
// them, and 613 of the 701 items warehouse 1101 stocks are covered. They
// live in this same database (odg_ecom.upload_blobs), so the POS serves
// them itself rather than depending on the shop's host being reachable.
//
// odg_ecom.product_images holds the ordering and the public path
// (/uploads/products/<code>/<uuid>.jpg); the bytes are keyed by that
// path split in two, subdir + filename.

type RouteContext = {
  params: Promise<{ code: string }>;
};

type BlobRow = {
  data: Buffer;
  content_type: string | null;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { code: raw } = await context.params;
  const code = decodeURIComponent(raw ?? "").trim();
  if (!code) {
    return NextResponse.json({ error: "Missing product code" }, { status: 400 });
  }

  const rows = await prisma.$queryRaw<BlobRow[]>`
    SELECT b.data, b.content_type
    FROM odg_ecom.product_images p
    JOIN odg_ecom.upload_blobs b
      ON b.subdir = 'products/' || p.product_code
     AND b.filename = split_part(p.url, '/', -1)
    WHERE p.product_code = ${code}
    ORDER BY p.sort_order, p.id
    LIMIT 1
  `;

  const row = rows[0];
  if (!row?.data) {
    return new NextResponse(null, { status: 404 });
  }

  // A product photo does not change without the file changing, and the
  // filename is a uuid — so when it does change the URL does too. Cache
  // it hard: the catalogue asks for up to 60 of these on every search.
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.content_type?.trim() || "image/jpeg",
      "Cache-Control": "private, max-age=86400, immutable",
      "Content-Length": String(row.data.length),
    },
  });
}
