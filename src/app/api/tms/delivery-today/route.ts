import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/tms/delivery-today
//
// Today's delivery load split by round (ຮອບ), pulled from the TMS tables:
//   - assigned = bills already on a trip today
//                (odg_tms_detail → odg_tms, date_logistic = today)
//   - pending  = bills scheduled for today but not yet dispatched
//                (odg_tms_pending_bill, scheduled_date = today),
//                excluding cancelled / postponed.
// Date is "today" in Asia/Vientiane (UTC+7).

function todayInVientiane(): string {
  const now = new Date();
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function isValidDate(s: string | null | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

type RoundRow = {
  code: string | null;
  name: string | null;
  time_label: string | null;
  sort_order: number | null;
};
type CountRow = { rnd: string | null; bills: string | number | null };

const NONE = "(none)";
const toNum = (v: string | number | null): number => (v == null ? 0 : Number(v) || 0);

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Defaults to today (Vientiane); the POS passes the selected ວັນຮັບສິນຄ້າ.
  const requested = request.nextUrl.searchParams.get("date")?.trim();
  const date = isValidDate(requested) ? requested : todayInVientiane();

  const [rounds, assigned, pending] = await Promise.all([
    prisma.$queryRaw<RoundRow[]>`
      SELECT code, name, time_label, sort_order
      FROM odg_tms_delivery_round
      WHERE active = TRUE
      ORDER BY sort_order
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COALESCE(NULLIF(h.delivery_round_code, ''), ${NONE}) AS rnd,
             COUNT(DISTINCT d.bill_no) AS bills
      FROM odg_tms h
      JOIN odg_tms_detail d ON d.doc_no = h.doc_no
      WHERE h.date_logistic = ${date}::date
      GROUP BY 1
    `,
    prisma.$queryRaw<CountRow[]>`
      SELECT COALESCE(NULLIF(delivery_round_code, ''), ${NONE}) AS rnd,
             COUNT(DISTINCT bill_no) AS bills
      FROM odg_tms_pending_bill
      WHERE scheduled_date = ${date}::date
        AND COALESCE(action_status, '') NOT IN ('customer_cancelled', 'customer_postponed')
      GROUP BY 1
    `,
  ]);

  const assignedBy = new Map<string, number>();
  for (const r of assigned) assignedBy.set(r.rnd ?? NONE, toNum(r.bills));
  const pendingBy = new Map<string, number>();
  for (const r of pending) pendingBy.set(r.rnd ?? NONE, toNum(r.bills));

  // Start from the configured rounds (keeps display order + nice names), then
  // append any round code that only shows up in the data (incl. the NONE
  // bucket) so no bills are silently dropped.
  const out: Array<{
    code: string;
    name: string;
    timeLabel: string | null;
    assigned: number;
    pending: number;
  }> = [];
  const seen = new Set<string>();
  for (const r of rounds) {
    const code = r.code ?? "";
    if (!code) continue;
    seen.add(code);
    out.push({
      code,
      name: r.name?.trim() || code,
      timeLabel: r.time_label?.trim() || null,
      assigned: assignedBy.get(code) ?? 0,
      pending: pendingBy.get(code) ?? 0,
    });
  }
  for (const code of new Set([...assignedBy.keys(), ...pendingBy.keys()])) {
    if (seen.has(code)) continue;
    out.push({
      code,
      name: code === NONE ? "ບໍ່ລະບຸຮອບ" : code,
      timeLabel: null,
      assigned: assignedBy.get(code) ?? 0,
      pending: pendingBy.get(code) ?? 0,
    });
  }

  const totals = out.reduce(
    (acc, r) => {
      acc.assigned += r.assigned;
      acc.pending += r.pending;
      return acc;
    },
    { assigned: 0, pending: 0 },
  );

  return NextResponse.json({ date, rounds: out, totals });
}
