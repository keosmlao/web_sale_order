import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// Only AIR / CE_SDA rosters exist (product_group AC -> AIR, CE/FZ -> CE_SDA);
// a reward on any other group would match nobody.
const REWARD_GROUPS: readonly string[] = ["AIR", "CE_SDA"];

// Unit-count spiff settings (workbook ④ brand / ⑤ pushed model) —
// app_incentive_unit_reward, sql/add-incentive-unit-reward.sql.
type UnitRewardRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  item_match: string | null;
  low_min_qty: string | number;
  low_reward: string | number;
  high_min_qty: string | number | null;
  high_reward: string | number | null;
  is_active: boolean;
};

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

async function listRewards() {
  const rows = await prisma.$queryRaw<UnitRewardRow[]>`
    SELECT reward_code, description, group_code, brand_code, item_match,
           low_min_qty, low_reward, high_min_qty, high_reward, is_active
    FROM app_incentive_unit_reward
    ORDER BY reward_code
  `;
  return {
    rewards: rows.map((r) => ({
      rewardCode: r.reward_code,
      description: r.description,
      groupCode: r.group_code,
      brandCode: r.brand_code,
      itemMatch: r.item_match,
      lowMinQty: Number(r.low_min_qty),
      lowReward: Number(r.low_reward),
      highMinQty: Number(r.high_min_qty ?? 0),
      highReward: Number(r.high_reward ?? 0),
      isActive: r.is_active,
    })),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await listRewards());
  } catch {
    return NextResponse.json(
      { error: "Unit-reward table missing. Run sql/add-incentive-unit-reward.sql first." },
      { status: 503 },
    );
  }
}

// Update one unit reward's scope (brand / model), tiers and active flag.
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rewardCode = String(body?.rewardCode ?? "").trim();
  const isActive = Boolean(body?.isActive);
  const brandCode = String(body?.brandCode ?? "").trim().toUpperCase() || null;
  const itemMatch = String(body?.itemMatch ?? "").trim() || null;
  const lowMinQty = Number(body?.lowMinQty);
  const lowReward = Number(body?.lowReward);
  const highMinQty = Number(body?.highMinQty);
  const highReward = Number(body?.highReward);
  const validNum = (n: number) => Number.isFinite(n) && n >= 0;
  if (
    !rewardCode ||
    !validNum(lowMinQty) || !validNum(lowReward) ||
    !validNum(highMinQty) || !validNum(highReward) ||
    // Exactly one qualifying scope: a brand OR a pushed model.
    (!brandCode && !itemMatch)
  ) {
    return NextResponse.json(
      { error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ — ຕ້ອງມີແບຮນດ໌ ຫຼື ຮຸ່ນ ຢ່າງໜ້ອຍໜຶ່ງ" },
      { status: 400 },
    );
  }
  const updated = await prisma.$executeRaw`
    UPDATE app_incentive_unit_reward
    SET is_active = ${isActive},
        brand_code = ${brandCode},
        item_match = ${itemMatch},
        low_min_qty = ${lowMinQty},
        low_reward = ${lowReward},
        high_min_qty = ${highMinQty},
        high_reward = ${highReward}
    WHERE reward_code = ${rewardCode}
  `;
  if (updated === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບ reward" }, { status: 404 });
  }
  return NextResponse.json(await listRewards());
}

// Create a new unit-count spiff. reward_code auto-generated; needs a brand OR a
// pushed model, and a group in AIR / CE_SDA.
export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const description = String(body?.description ?? "").trim();
  const groupCode = String(body?.groupCode ?? "").trim().toUpperCase();
  const brandCode = String(body?.brandCode ?? "").trim().toUpperCase() || null;
  const itemMatch = String(body?.itemMatch ?? "").trim() || null;
  const lowMinQty = Number(body?.lowMinQty);
  const lowReward = Number(body?.lowReward);
  const highMinQty = Number(body?.highMinQty);
  const highReward = Number(body?.highReward);
  const isActive = body?.isActive === undefined ? true : Boolean(body?.isActive);
  const validNum = (n: number) => Number.isFinite(n) && n >= 0;
  if (
    !description ||
    !REWARD_GROUPS.includes(groupCode) ||
    !validNum(lowMinQty) || !validNum(lowReward) ||
    !validNum(highMinQty) || !validNum(highReward) ||
    (!brandCode && !itemMatch)
  ) {
    return NextResponse.json(
      { error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ — ຕ້ອງມີຄຳອະທິບາຍ, group ແລະ ແບຮນດ໌ ຫຼື ຮຸ່ນ" },
      { status: 400 },
    );
  }
  const rewardCode = `UNR_${randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.$executeRaw`
    INSERT INTO app_incentive_unit_reward
      (reward_code, description, group_code, brand_code, item_match,
       low_min_qty, low_reward, high_min_qty, high_reward, is_active)
    VALUES (${rewardCode}, ${description}, ${groupCode}, ${brandCode}, ${itemMatch},
            ${lowMinQty}, ${lowReward}, ${highMinQty}, ${highReward}, ${isActive})
  `;
  return NextResponse.json(await listRewards());
}

export async function DELETE(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const code = new URL(request.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "ບໍ່ໄດ້ລະບຸ reward" }, { status: 400 });
  const removed = await prisma.$executeRaw`
    DELETE FROM app_incentive_unit_reward WHERE reward_code = ${code}
  `;
  if (removed === 0) return NextResponse.json({ error: "ບໍ່ພົບ reward" }, { status: 404 });
  return NextResponse.json(await listRewards());
}
