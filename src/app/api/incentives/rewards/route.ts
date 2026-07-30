import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// ALL uses the complete monthly target roster and the whole department's
// eligible walk-in sales. AIR / CE_SDA retain the product-group scopes.
const REWARD_GROUPS: readonly string[] = ["ALL", "AIR", "CE_SDA"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type RewardRow = {
  reward_code: string;
  description: string;
  group_code: string;
  brand_code: string | null;
  target_amount: string | number;
  reward_amount: string | number;
  split_by_share: boolean;
  is_active: boolean;
  effective_from: string;
  effective_to: string;
};

const canManage = (employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) => {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
};

async function listRewards(year = 0, month = 0) {
  const rows = await prisma.$queryRaw<RewardRow[]>`
    SELECT reward_code, description, group_code, brand_code,
           target_amount, reward_amount, split_by_share, is_active,
           effective_from::text, effective_to::text
    FROM app_incentive_special_reward
    WHERE (${year} = 0 OR ${month} = 0 OR
      (effective_from < make_date(${year}, ${month}, 1) + INTERVAL '1 month'
       AND effective_to >= make_date(${year}, ${month}, 1)))
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
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
    })),
  };
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listRewards(Number(url.searchParams.get("year")), Number(url.searchParams.get("month"))));
  } catch {
    return NextResponse.json(
      { error: "Reward table missing. Run sql/add-incentive-point-map.sql first." },
      { status: 503 },
    );
  }
}

// Update one reward's active flag, target, amount and active date range.
export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!canManage(employee)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ເງິນພິເສດ" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const rewardCode = String(body?.rewardCode ?? "").trim();
  const isActive = Boolean(body?.isActive);
  const splitByShare = Boolean(body?.splitByShare);
  const targetAmount = Number(body?.targetAmount);
  const rewardAmount = Number(body?.rewardAmount);
  const effectiveFrom = String(body?.effectiveFrom ?? "");
  const effectiveTo = String(body?.effectiveTo ?? "");
  if (
    !rewardCode ||
    !Number.isFinite(targetAmount) || targetAmount < 0 ||
    !Number.isFinite(rewardAmount) || rewardAmount < 0 ||
    !DATE_RE.test(effectiveFrom) || !DATE_RE.test(effectiveTo) || effectiveTo < effectiveFrom
  ) {
    return NextResponse.json({ error: "ຂໍ້ມູນເງິນພິເສດບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const updated = await prisma.$executeRaw`
    UPDATE app_incentive_special_reward
    SET is_active = ${isActive},
        split_by_share = ${splitByShare},
        target_amount = ${targetAmount},
        reward_amount = ${rewardAmount},
        effective_from = ${effectiveFrom}::date,
        effective_to = ${effectiveTo}::date
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
  const effectiveFrom = String(body?.effectiveFrom ?? "");
  const effectiveTo = String(body?.effectiveTo ?? "");
  if (
    !description ||
    !REWARD_GROUPS.includes(groupCode) ||
    !Number.isFinite(targetAmount) || targetAmount < 0 ||
    !Number.isFinite(rewardAmount) || rewardAmount < 0 ||
    !DATE_RE.test(effectiveFrom) || !DATE_RE.test(effectiveTo) || effectiveTo < effectiveFrom
  ) {
    return NextResponse.json(
      { error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ — ຕ້ອງມີຄຳອະທິບາຍ, group ແລະຊ່ວງວັນທີ" },
      { status: 400 },
    );
  }
  const rewardCode = `SPR_${randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.$executeRaw`
    INSERT INTO app_incentive_special_reward
      (reward_code, description, group_code, brand_code,
       target_amount, reward_amount, split_by_share, is_active,
       effective_from, effective_to)
    VALUES (${rewardCode}, ${description}, ${groupCode}, ${brandCode},
            ${targetAmount}, ${rewardAmount}, ${splitByShare}, ${isActive},
            ${effectiveFrom}::date, ${effectiveTo}::date)
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
