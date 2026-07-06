import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Per-position commission-rate tiers — see sql/add-incentive-commission-tier.sql.
// A PUT replaces the WHOLE table (all positions) so the editor is the single
// source of truth for the rate rule.

const POSITIONS = ["13", "11", "12"] as const;
const MODES = ["zero", "round_down", "round_up", "exact"] as const;

type TierInput = { positionCode: string; fromPct: number; mode: string; roundStep: number };

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const rows = await prisma.$queryRaw<Array<{
      position_code: string;
      from_pct: string | number;
      mode: string;
      round_step: string | number;
    }>>`
      SELECT position_code, from_pct, mode, round_step
      FROM app_incentive_commission_tier
      ORDER BY position_code, from_pct
    `;
    return NextResponse.json({
      tiers: rows.map((r) => ({
        positionCode: r.position_code,
        fromPct: Number(r.from_pct),
        mode: r.mode,
        roundStep: Number(r.round_step),
      })),
    });
  } catch {
    // Table not migrated yet.
    return NextResponse.json({ tiers: null });
  }
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ Config Incentive" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { tiers?: TierInput[] } | null;
  const raw = body?.tiers ?? [];

  // Validate every tier; a single bad row rejects the whole save.
  const tiers = raw.map((t) => ({
    positionCode: String(t.positionCode),
    fromPct: Number(t.fromPct),
    mode: String(t.mode),
    roundStep: Number(t.roundStep),
  }));
  const valid = tiers.every(
    (t) =>
      POSITIONS.includes(t.positionCode as (typeof POSITIONS)[number]) &&
      MODES.includes(t.mode as (typeof MODES)[number]) &&
      Number.isFinite(t.fromPct) && t.fromPct >= 0 && t.fromPct <= 5 &&
      Number.isFinite(t.roundStep) && t.roundStep > 0 && t.roundStep <= 1,
  );
  if (!valid) {
    return NextResponse.json({ error: "ຂໍ້ມູນຂັ້ນຄ່າຄອມບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  // Reject duplicate from_pct within a position (would violate the unique key).
  const seen = new Set<string>();
  for (const t of tiers) {
    const key = `${t.positionCode}|${t.fromPct}`;
    if (seen.has(key)) {
      return NextResponse.json({ error: `ຂັ້ນ % ຊ້ຳກັນ (ຕຳແໜ່ງ ${t.positionCode}, ${Math.round(t.fromPct * 100)}%)` }, { status: 400 });
    }
    seen.add(key);
  }
  // Each position must keep at least one tier so a rate can always be resolved.
  for (const pos of POSITIONS) {
    if (!tiers.some((t) => t.positionCode === pos)) {
      return NextResponse.json({ error: `ຕຳແໜ່ງ ${pos} ຕ້ອງມີຢ່າງໜ້ອຍ 1 ຂັ້ນ` }, { status: 400 });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM app_incentive_commission_tier`;
      for (const t of tiers) {
        await tx.$executeRaw`
          INSERT INTO app_incentive_commission_tier (position_code, from_pct, mode, round_step)
          VALUES (${t.positionCode}, ${t.fromPct}, ${t.mode}, ${t.roundStep})
        `;
      }
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "ຕາຕະລາງຍັງບໍ່ຖືກສ້າງ — ຮັນ node scripts/apply-sql.mjs sql/add-incentive-commission-tier.sql ກ່ອນ" },
      { status: 503 },
    );
  }
}
