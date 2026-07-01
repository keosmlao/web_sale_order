import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

type ConfigRow = {
  base_amount: string | number;
  currency_code: string;
  low_max_pct: string | number;
  standard_max_pct: string | number;
  low_multiplier: string | number;
  standard_multiplier: string | number;
  high_multiplier: string | number;
  updated_at: Date;
};

type TargetRow = {
  roworder: number;
  emp_code: string;
  display_name: string | null;
  year: string;
  month: string;
  product_group: string;
  target: string | number;
};

function output(config: ConfigRow, targets: TargetRow[]) {
  return {
    config: {
      baseAmount: Number(config.base_amount),
      currencyCode: config.currency_code,
      lowMaxPct: Number(config.low_max_pct),
      standardMaxPct: Number(config.standard_max_pct),
      lowMultiplier: Number(config.low_multiplier),
      standardMultiplier: Number(config.standard_multiplier),
      highMultiplier: Number(config.high_multiplier),
      updatedAt: config.updated_at.toISOString(),
    },
    targets: targets.map((row) => ({
      rowOrder: row.roworder,
      employeeCode: row.emp_code,
      displayName: row.display_name ?? row.emp_code,
      year: Number(row.year),
      month: Number(row.month),
      groupCode: row.product_group,
      target: Number(row.target),
    })),
  };
}

async function readConfig() {
  const [configs, targets] = await Promise.all([
    prisma.$queryRaw<ConfigRow[]>`
      SELECT base_amount, currency_code, low_max_pct, standard_max_pct,
             low_multiplier, standard_multiplier, high_multiplier, updated_at
      FROM app_incentive_config WHERE id = 1
    `,
    prisma.$queryRaw<TargetRow[]>`
      SELECT target.roworder, target.emp_code,
             COALESCE(NULLIF(employee.fullname_lo, ''), NULLIF(employee.nickname, ''), target.emp_code) AS display_name,
             target.year, target.month, target.product_group, target.target
      FROM odg_retail_target_employee target
      LEFT JOIN odg_employee employee ON employee.employee_code = target.emp_code
      ORDER BY target.year DESC, target.month DESC, target.product_group, display_name
    `,
  ]);
  return output(configs[0], targets);
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await readConfig());
}

export async function PUT(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ Config Incentive" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    config?: Record<string, unknown>;
    targets?: Array<Record<string, unknown>>;
  } | null;
  const config = body?.config ?? {};
  const base = Number(config.baseAmount);
  const lowMax = Number(config.lowMaxPct);
  const standardMax = Number(config.standardMaxPct);
  const lowMultiplier = Number(config.lowMultiplier);
  const standardMultiplier = Number(config.standardMultiplier);
  const highMultiplier = Number(config.highMultiplier);
  const currency = typeof config.currencyCode === "string"
    ? config.currencyCode.trim().toUpperCase().slice(0, 10)
    : "THB";

  if (![base, lowMax, standardMax, lowMultiplier, standardMultiplier, highMultiplier].every(Number.isFinite) ||
      base < 0 || lowMax <= 0 || standardMax < lowMax ||
      lowMultiplier < 0 || standardMultiplier < 0 || highMultiplier < 0 || !currency) {
    return NextResponse.json({ error: "ຄ່າ Config ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const targets = (body?.targets ?? []).map((row) => ({
    rowOrder: Number(row.rowOrder),
    employeeCode: String(row.employeeCode ?? ""),
    year: Number(row.year),
    month: Number(row.month),
    groupCode: String(row.groupCode ?? ""),
    target: Number(row.target),
  }));
  const validTargets = targets.every((row) =>
    Number.isInteger(row.year) && row.year >= 2020 && row.year <= 2100 &&
    Number.isInteger(row.month) && row.month >= 1 && row.month <= 12 &&
    Number.isInteger(row.rowOrder) && row.rowOrder > 0 && row.employeeCode.length > 0 &&
    ["CE", "AC"].includes(row.groupCode) &&
    Number.isFinite(row.target) && row.target >= 0
  );
  if (!validTargets) return NextResponse.json({ error: "ຂໍ້ມູນເປົ້າລາຍເດືອນບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE app_incentive_config SET
        base_amount = ${base}, currency_code = ${currency},
        low_max_pct = ${lowMax}, standard_max_pct = ${standardMax},
        low_multiplier = ${lowMultiplier}, standard_multiplier = ${standardMultiplier},
        high_multiplier = ${highMultiplier}, updated_at = now()
      WHERE id = 1
    `;
    for (const row of targets) {
      await tx.$executeRaw`
        UPDATE odg_retail_target_employee
        SET target = ${row.target}
        WHERE roworder = ${row.rowOrder}
          AND emp_code = ${row.employeeCode}
      `;
    }
  });
  return NextResponse.json(await readConfig());
}

export async function POST(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = roleFromEmployee(employee);
  if (role !== "manager" && role !== "head") {
    return NextResponse.json({ error: "ບໍ່ມີສິດເພີ່ມ Target" }, { status: 403 });
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const employeeCode = String(body?.employeeCode ?? "").trim();
  const year = Number(body?.year);
  const month = Number(body?.month);
  const groupCode = String(body?.groupCode ?? "").trim().toUpperCase();
  const target = Number(body?.target);
  if (!employeeCode || !Number.isInteger(year) || year < 2020 || year > 2100 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !["CE", "AC"].includes(groupCode) || !Number.isFinite(target) || target < 0) {
    return NextResponse.json({ error: "ຂໍ້ມູນ Target ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const exists = await prisma.$queryRaw<Array<{ roworder: number }>>`
    SELECT roworder FROM odg_retail_target_employee
    WHERE emp_code = ${employeeCode}
      AND year = ${year.toString()}
      AND LPAD(month, 2, '0') = LPAD(${month.toString()}, 2, '0')
      AND product_group = ${groupCode}
    LIMIT 1
  `;
  if (exists.length > 0) {
    return NextResponse.json({ error: "Target ຂອງພະນັກງານ/ເດືອນ/ກຸ່ມນີ້ມີແລ້ວ" }, { status: 409 });
  }
  const found = await prisma.$queryRaw<Array<{ employee_code: string }>>`
    SELECT employee_code FROM odg_employee WHERE employee_code = ${employeeCode} LIMIT 1
  `;
  if (found.length === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບລະຫັດພະນັກງານ" }, { status: 404 });
  }
  await prisma.$executeRaw`
    INSERT INTO odg_retail_target_employee (emp_code, target, year, month, product_group)
    VALUES (${employeeCode}, ${target}, ${year.toString()}, ${month.toString().padStart(2, "0")}, ${groupCode})
  `;
  return NextResponse.json(await readConfig(), { status: 201 });
}
