import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

const number = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

function period(url: URL) {
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month, mm: String(month).padStart(2, "0") };
}

function sheet(rows: Array<Record<string, unknown>>, widths: number[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: range.s, e: { r: range.s.r, c: range.e.c } }) };
  return ws;
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const selected = period(new URL(request.url));
  if (!selected) return NextResponse.json({ error: "year/month ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  const { year, month, mm } = selected;

  const [targets, rewards, unitRewards, points, statuses] = await Promise.all([
    prisma.$queryRaw<Array<{ employee_code: string; fullname_lo: string | null; nickname: string | null; ce: string | number | null; ac: string | number | null }>>`
      SELECT e.employee_code, e.fullname_lo, e.nickname,
             MAX(t.target) FILTER (WHERE t.product_group = 'CE') AS ce,
             MAX(t.target) FILTER (WHERE t.product_group = 'AC') AS ac
      FROM odg_employee e
      LEFT JOIN odg_retail_target_employee t
        ON t.emp_code = e.employee_code
       AND t.year = ${year.toString()}
       AND LPAD(t.month, 2, '0') = ${mm}
      WHERE e.position_code = '13' AND e.department_code = '205'
        AND COALESCE(e.employment_status, 'ACTIVE') = 'ACTIVE'
      GROUP BY e.employee_code, e.fullname_lo, e.nickname
      ORDER BY e.employee_code
    `,
    prisma.$queryRaw<Array<Record<string, string | number | boolean | null>>>`
      SELECT reward_code, description, group_code, brand_code, target_amount,
             reward_amount, split_by_share, is_active,
             effective_from::text, effective_to::text
      FROM app_incentive_special_reward
      WHERE effective_from < make_date(${year},${month},1) + INTERVAL '1 month'
        AND effective_to >= make_date(${year},${month},1)
      ORDER BY reward_code
    `,
    prisma.$queryRaw<Array<Record<string, string | number | boolean | null>>>`
      SELECT reward_code, description, group_code, brand_code, item_match,
             low_min_qty, low_reward, high_min_qty, high_reward, is_active,
             effective_from::text, effective_to::text
      FROM app_incentive_unit_reward
      WHERE effective_from < make_date(${year},${month},1) + INTERVAL '1 month'
        AND effective_to >= make_date(${year},${month},1)
      ORDER BY reward_code
    `,
    prisma.$queryRaw<Array<Record<string, string | number | boolean | bigint | null>>>`
      SELECT category_code, brand_code, design_token, size_token, points,
             is_special, effective_from::text, effective_to::text
      FROM app_incentive_point_rule
      WHERE effective_from < make_date(${year},${month},1) + INTERVAL '1 month'
        AND effective_to >= make_date(${year},${month},1)
      ORDER BY category_code, brand_code, design_token, size_token, effective_from
    `,
    prisma.$queryRaw<Array<Record<string, string | number | null>>>`
      SELECT ps.item_code, i.name_1 AS item_name, ps.status_code, ps.weight,
             ps.note, ps.effective_from::text, ps.effective_to::text
      FROM app_incentive_product_status_rule ps
      LEFT JOIN ic_inventory i ON i.code = ps.item_code
      WHERE ps.effective_from < make_date(${year},${month},1) + INTERVAL '1 month'
        AND ps.effective_to >= make_date(${year},${month},1)
      ORDER BY ps.status_code, ps.item_code
    `,
  ]);

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `Incentive ${mm}/${year}`, Subject: "Monthly retail incentive configuration", Author: employee.employeeCode ?? "ODG" };

  const targetRows = targets.map((row, index) => ({
    "ລ/ດ": index + 1,
    "ລະຫັດພະນັກງານ": row.employee_code,
    "ຊື່ພະນັກງານ": row.fullname_lo?.trim() || row.nickname?.trim() || row.employee_code,
    "ເປົ້າ CE": number(row.ce),
    "ເປົ້າ AC": number(row.ac),
    "ເປົ້າລວມ": number(row.ce) + number(row.ac),
  }));
  XLSX.utils.book_append_sheet(wb, sheet(targetRows, [7, 18, 32, 16, 16, 16]), "Targets");

  XLSX.utils.book_append_sheet(wb, sheet(rewards.map((row) => ({
    "ລະຫັດ": row.reward_code, "ລາຍລະອຽດ": row.description,
    "ກຸ່ມ": row.group_code, "ຍີ່ຫໍ້": row.brand_code ?? "",
    "ເປົ້າ": number(row.target_amount as string | number),
    "ລາງວັນ": number(row.reward_amount as string | number),
    "ແບ່ງຕາມສັດສ່ວນ": row.split_by_share ? "ແມ່ນ" : "ບໍ່",
    "ເປີດໃຊ້": row.is_active ? "ແມ່ນ" : "ບໍ່",
    "ຈາກວັນທີ": row.effective_from, "ຫາວັນທີ": row.effective_to,
  })), [20, 45, 12, 16, 16, 16, 18, 12, 14, 14]), "Special Rewards");

  XLSX.utils.book_append_sheet(wb, sheet(unitRewards.map((row) => ({
    "ລະຫັດ": row.reward_code, "ລາຍລະອຽດ": row.description,
    "ກຸ່ມ": row.group_code, "ຍີ່ຫໍ້": row.brand_code ?? "", "ລະຫັດສິນຄ້າ": row.item_match ?? "",
    "ຈຳນວນຂັ້ນ 1": number(row.low_min_qty as string | number), "ລາງວັນຂັ້ນ 1": number(row.low_reward as string | number),
    "ຈຳນວນຂັ້ນ 2": number(row.high_min_qty as string | number), "ລາງວັນຂັ້ນ 2": number(row.high_reward as string | number),
    "ເປີດໃຊ້": row.is_active ? "ແມ່ນ" : "ບໍ່", "ຈາກວັນທີ": row.effective_from, "ຫາວັນທີ": row.effective_to,
  })), [20, 42, 12, 16, 18, 15, 16, 15, 16, 12, 14, 14]), "Unit Rewards");

  XLSX.utils.book_append_sheet(wb, sheet(points.map((row) => ({
    "ໝວດ": row.category_code, "ຍີ່ຫໍ້": row.brand_code,
    "Design": row.design_token, "Size/Price": row.size_token,
    "ຄະແນນ": number(row.points as string | number), "ກົດພິເສດ": row.is_special ? "ແມ່ນ" : "ບໍ່",
    "ຈາກວັນທີ": row.effective_from, "ຫາວັນທີ": row.effective_to,
  })), [12, 18, 18, 18, 12, 14, 14, 14]), "Point Map");

  const statusName: Record<string, string> = { special_no_bonus: "ບໍ່ຈ່າຍ", special_min_bonus: "Min ×0.5", special_promo_max: "Max ×1.2" };
  XLSX.utils.book_append_sheet(wb, sheet(statuses.map((row) => ({
    "ລະຫັດສິນຄ້າ": row.item_code, "ຊື່ສິນຄ້າ": row.item_name ?? "",
    "ສະຖານະ": statusName[String(row.status_code)] ?? row.status_code,
    "ຕົວຄູນ": number(row.weight as string | number), "ໝາຍເຫດ": row.note ?? "",
    "ຈາກວັນທີ": row.effective_from, "ຫາວັນທີ": row.effective_to,
  })), [20, 55, 18, 12, 28, 14, 14]), "Product Status");

  const output = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  const filename = `incentive-${year}-${mm}.xlsx`;
  return new NextResponse(new Uint8Array(output), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
