import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// The eligibility roster only ever produces these two groups (product_group
// AC -> AIR, CE/FZ -> CE_SDA), so a reward attached to anything else would have
// no members. Constrain new rewards to the meaningful set.
const REWARD_GROUPS: readonly string[] = ["AIR", "CE_SDA"];

type RewardRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
  is_active: boolean;
};

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

async function listRewards() {
  const rows = await prisma.$queryRaw<RewardRow[]>`
    SELECT reward_code, description, group_code, brand_code,
           target_amount, reward_amount, split_by_share, is_active
    FROM app_incentive_special_reward
    ORDER BY reward_code
  `;
  return {
    rewards: rows.map((r) => ({
      rewardCode: r.reward_code,
      description: r.description,
      groupCode: r.group_code,
      brandCode: r.brand_code,
      targetAmount: Number(r.target_amount),
      rewardAmount: Number(r.reward_amount),
      splitByShare: r.split_by_share,
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
      { error: "Reward table missing. Run sql/add-incentive-point-map.sql first." },
      { status: 503 },
    );
  }
}

// Update one reward's active flag / target / amount (structural fields stay fixed).
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rewardCode = String(body?.rewardCode ?? "").trim();
  const isActive = Boolean(body?.isActive);
  const targetAmount = Number(body?.targetAmount);
  const rewardAmount = Number(body?.rewardAmount);
  if (
    !rewardCode ||
    !Number.isFinite(targetAmount) || targetAmount < 0 ||
    !Number.isFinite(rewardAmount) || rewardAmount < 0
  ) {
    return NextResponse.json({ error: "ຂໍ້ມູນເງິນພິເສດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const updated = await prisma.$executeRaw`
    UPDATE app_incentive_special_reward
    SET is_active = ${isActive},
        target_amount = ${targetAmount},
        reward_amount = ${rewardAmount}
    WHERE reward_code = ${rewardCode}
  `;
  if (updated === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບ reward" }, { status: 404 });
  }
  return NextResponse.json(await listRewards());
}

// Create a new special-reward program. reward_code is auto-generated; the
// group is constrained to AIR / CE_SDA (see REWARD_GROUPS).
export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const description = String(body?.description ?? "").trim();
  const groupCode = String(body?.groupCode ?? "").trim().toUpperCase();
  const brandCode = String(body?.brandCode ?? "").trim().toUpperCase() || null;
  const targetAmount = Number(body?.targetAmount);
  const rewardAmount = Number(body?.rewardAmount);
  const splitByShare = Boolean(body?.splitByShare);
  const isActive = body?.isActive === undefined ? true : Boolean(body?.isActive);
  if (
    !description ||
    !REWARD_GROUPS.includes(groupCode) ||
    !Number.isFinite(targetAmount) || targetAmount < 0 ||
    !Number.isFinite(rewardAmount) || rewardAmount < 0
  ) {
    return NextResponse.json(
      { error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ — ຕ້ອງມີຄຳອະທິບາຍ ແລະ ເລືອກ group (AIR/CE_SDA)" },
      { status: 400 },
    );
  }
  const rewardCode = `SPR_${randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.$executeRaw`
    INSERT INTO app_incentive_special_reward
      (reward_code, description, group_code, brand_code,
       target_amount, reward_amount, split_by_share, is_active)
    VALUES (${rewardCode}, ${description}, ${groupCode}, ${brandCode},
            ${targetAmount}, ${rewardAmount}, ${splitByShare}, ${isActive})
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
    DELETE FROM app_incentive_special_reward WHERE reward_code = ${code}
  `;
  if (removed === 0) return NextResponse.json({ error: "ບໍ່ພົບ reward" }, { status: 404 });
  return NextResponse.json(await listRewards());
}
