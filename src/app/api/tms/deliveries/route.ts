import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";

// GET /api/tms/deliveries?date=YYYY-MM-DD&round=R001&scope=own|all&q=...
//
// Delivery tracking for THIS app's bills only (doc_format_code = 'CAKAP'). The
// list is based on the app's bills so each appears the moment it's opened, then
// shows its delivery stage as TMS picks it up:
//   opened     — bill issued, not yet scheduled/dispatched
//   scheduled  — in odg_tms_pending_bill (nat a round, not on a truck)
//   inprogress — on a trip (odg_tms_detail) but not finished
//   done       — odg_tms_detail.status = 1
//   cancelled  — odg_tms_detail.status = 2
// `date` filters by the bill's creation date (doc_date). `scope=all` is gated
// to head/manager; everyone else sees only their own bills.

function todayInVientiane(): string {
  const now = new Date();
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isValidDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

type Row = {
  bill_no: string;
  bill_date: string | null;
  cust_code: string | null;
  customer_name: string | null;
  telephone: string | null;
  sale_code: string | null;
  salesperson_name: string | null;
  round_code: string | null;
  round_name: string | null;
  time_label: string | null;
  car_label: string | null;
  driver_name: string | null;
  driver_tel: string | null;
  has_detail: boolean;
  d_status: number | null;
  has_pending: boolean;
  sent_end: string | null;
  job_no: string | null;
  lat: string | null;
  lng: string | null;
};

type Stage = "opened" | "scheduled" | "inprogress" | "done" | "cancelled";

function stageOf(r: Row): Stage {
  if (r.d_status === 1) return "done";
  if (r.d_status === 2) return "cancelled";
  if (r.has_detail) return "inprogress";
  if (r.has_pending) return "scheduled";
  return "opened";
}

function canSeeAll(employee: Awaited<ReturnType<typeof getEmployeeFromRequest>>) {
  if (!employee) return false;
  const role = roleFromEmployee(employee);
  return role === "manager" || role === "head";
}

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const rawDate = sp.get("date")?.trim();
  const date = isValidDate(rawDate) ? rawDate : todayInVientiane();
  const round = sp.get("round")?.trim() || "";
  const q = sp.get("q")?.trim() || "";
  const wantAll = sp.get("scope") === "all";
  const allowAll = canSeeAll(employee);
  const scopeOwn = !(wantAll && allowAll);
  const myCode = employee.employeeCode ?? "";

  // Bills tracked here: (a) this app's own receipts (CAKAP), plus (b) customer
  // bills opened at the Khualuang storefront — warehouse 1101 on a detail line,
  // with a customer (so internal stock transfers FT/FR/WEOH are excluded).
  const filters: Prisma.Sql[] = [
    Prisma.sql`(
      t.doc_format_code = 'CAKAP'
      OR (
        t.doc_format_code <> 'SOK'
        AND NULLIF(t.cust_code, '') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM ic_trans_detail td
          WHERE td.doc_no = t.doc_no AND td.wh_code = '1101'
        )
      )
    )`,
    Prisma.sql`t.doc_date = ${date}::date`,
  ];
  if (scopeOwn) filters.push(Prisma.sql`t.sale_code = ${myCode}`);
  if (round) filters.push(Prisma.sql`COALESCE(ld.round_code, pb.delivery_round_code) = ${round}`);
  if (q) {
    const like = `%${q.toUpperCase()}%`;
    filters.push(
      Prisma.sql`(UPPER(t.doc_no) LIKE ${like} OR UPPER(COALESCE(ar.name_1,'')) LIKE ${like})`,
    );
  }
  const where = Prisma.join(filters, " AND ");

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      t.doc_no AS bill_no,
      TO_CHAR(t.doc_date, 'DD/MM/YYYY') AS bill_date,
      t.cust_code,
      ar.name_1 AS customer_name,
      COALESCE(NULLIF(ld.telephone, ''), ar.telephone) AS telephone,
      NULLIF(t.sale_code, '') AS sale_code,
      COALESCE(emp.fullname_lo, emp.nickname, NULLIF(t.sale_code, '')) AS salesperson_name,
      COALESCE(ld.round_code, pb.delivery_round_code) AS round_code,
      dr.name AS round_name,
      dr.time_label,
      COALESCE(NULLIF(car.plate_no, ''), NULLIF(car.name_1, ''), NULLIF(ld.car, '')) AS car_label,
      drv.name_1 AS driver_name,
      drv.tel AS driver_tel,
      (ld.bill_no IS NOT NULL) AS has_detail,
      ld.status AS d_status,
      (pb.bill_no IS NOT NULL) AS has_pending,
      TO_CHAR(ld.sent_end, 'DD/MM/YYYY HH24:MI') AS sent_end,
      ld.job_no,
      ld.lat, ld.lng
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN odg_employee emp ON emp.employee_code = NULLIF(t.sale_code, '')
    LEFT JOIN LATERAL (
      SELECT d.bill_no, d.status, d.sent_end, d.telephone, d.lat, d.lng,
             h.delivery_round_code AS round_code, h.car, h.driver, h.doc_no AS job_no
      FROM odg_tms_detail d
      JOIN odg_tms h ON h.doc_no = d.doc_no
      WHERE d.bill_no = t.doc_no
      ORDER BY d.doc_date DESC NULLS LAST
      LIMIT 1
    ) ld ON TRUE
    LEFT JOIN LATERAL (
      SELECT p.bill_no, p.delivery_round_code
      FROM odg_tms_pending_bill p
      WHERE p.bill_no = t.doc_no
      LIMIT 1
    ) pb ON TRUE
    LEFT JOIN odg_tms_delivery_round dr ON dr.code = COALESCE(ld.round_code, pb.delivery_round_code)
    LEFT JOIN odg_tms_car car ON car.code = ld.car
    LEFT JOIN odg_tms_driver drv ON drv.code = ld.driver
    WHERE ${where}
    ORDER BY t.doc_no DESC
  `;

  const items = rows.map((r) => ({
    billNo: r.bill_no,
    billDate: r.bill_date,
    custCode: r.cust_code,
    customerName: r.customer_name?.trim() || r.cust_code || "—",
    telephone: r.telephone?.trim() || null,
    saleCode: r.sale_code,
    salespersonName: r.salesperson_name?.trim() || r.sale_code || "—",
    roundCode: r.round_code,
    roundName: r.round_name?.trim() || (r.round_code ?? "—"),
    timeLabel: r.time_label?.trim() || null,
    car: r.car_label?.trim() || "—",
    driverName: r.driver_name?.trim() || "—",
    driverTel: r.driver_tel?.trim() || null,
    status: stageOf(r),
    jobNo: r.job_no,
    sentEnd: r.sent_end,
    lat: r.lat ? Number(r.lat) : null,
    lng: r.lng ? Number(r.lng) : null,
  }));

  const summary = {
    total: items.length,
    opened: items.filter((i) => i.status === "opened").length,
    scheduled: items.filter((i) => i.status === "scheduled").length,
    inprogress: items.filter((i) => i.status === "inprogress").length,
    done: items.filter((i) => i.status === "done").length,
    cancelled: items.filter((i) => i.status === "cancelled").length,
  };

  return NextResponse.json({
    date,
    scope: scopeOwn ? "own" : "all",
    canSeeAll: allowAll,
    summary,
    items,
  });
}
