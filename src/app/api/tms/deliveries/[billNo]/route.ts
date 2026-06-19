import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeFromRequest } from "@/lib/auth";

// GET /api/tms/deliveries/<billNo>
//
// One app bill's (CAKAP) delivery detail + full lifecycle timeline:
//   ເປີດບິນ → (ນັດສົ່ງ) → ຈັດຖ້ຽວແລ້ວ → ຮັບຖ້ຽວ/ເບີກເຄື່ອງ → ເລີ່ມຈັດສົ່ງ →
//   ຈັດສົ່ງສຳເລັດ / ຍົກເລີກ. Works before TMS picks the bill up (shows only the
//   ເປີດບິນ step in that case).

type RouteContext = { params: Promise<{ billNo: string }> };

type HeaderRow = {
  bill_no: string;
  opened_at: Date | null;
  cust_code: string | null;
  customer_name: string | null;
  telephone: string | null;
  salesperson_name: string | null;
  round_name: string | null;
  time_label: string | null;
  route_name: string | null;
  car_label: string | null;
  driver_name: string | null;
  driver_tel: string | null;
  has_detail: boolean;
  d_status: number | null;
  scheduled_date: Date | null;
  scheduled_round: string | null;
  lat: string | null;
  lng: string | null;
};
type StepRow = { event_at: Date | null; label: string; remark: string | null };

export async function GET(request: NextRequest, context: RouteContext) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { billNo } = await context.params;
  const bill = billNo.trim();
  if (!bill) {
    return NextResponse.json({ error: "missing billNo" }, { status: 400 });
  }

  const headerRows = await prisma.$queryRaw<HeaderRow[]>`
    SELECT
      t.doc_no AS bill_no,
      COALESCE(t.create_datetime, t.doc_date::timestamp) AS opened_at,
      t.cust_code,
      ar.name_1 AS customer_name,
      COALESCE(NULLIF(ld.telephone, ''), ar.telephone) AS telephone,
      COALESCE(emp.fullname_lo, emp.nickname, NULLIF(t.sale_code, '')) AS salesperson_name,
      dr.name AS round_name,
      dr.time_label,
      rt.name AS route_name,
      COALESCE(NULLIF(car.plate_no, ''), NULLIF(car.name_1, ''), NULLIF(ld.car, '')) AS car_label,
      drv.name_1 AS driver_name,
      drv.tel AS driver_tel,
      (ld.bill_no IS NOT NULL) AS has_detail,
      ld.status AS d_status,
      pb.scheduled_date,
      pb.delivery_round_code AS scheduled_round,
      ld.lat, ld.lng
    FROM ic_trans t
    LEFT JOIN ar_customer ar ON ar.code = t.cust_code
    LEFT JOIN odg_employee emp ON emp.employee_code = NULLIF(t.sale_code, '')
    LEFT JOIN LATERAL (
      SELECT d.bill_no, d.status, d.telephone, d.lat, d.lng,
             h.delivery_round_code AS round_code, h.delivery_route_code AS route_code,
             h.car, h.driver
      FROM odg_tms_detail d
      JOIN odg_tms h ON h.doc_no = d.doc_no
      WHERE d.bill_no = t.doc_no
      ORDER BY d.doc_date DESC NULLS LAST
      LIMIT 1
    ) ld ON TRUE
    LEFT JOIN LATERAL (
      SELECT p.scheduled_date, p.delivery_round_code
      FROM odg_tms_pending_bill p WHERE p.bill_no = t.doc_no LIMIT 1
    ) pb ON TRUE
    LEFT JOIN odg_tms_delivery_round dr ON dr.code = COALESCE(ld.round_code, pb.delivery_round_code)
    LEFT JOIN odg_tms_delivery_route rt ON rt.code = ld.route_code
    LEFT JOIN odg_tms_car car ON car.code = ld.car
    LEFT JOIN odg_tms_driver drv ON drv.code = ld.driver
    WHERE t.doc_no = ${bill} AND t.doc_format_code = 'CAKAP'
    LIMIT 1
  `;

  if (headerRows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const h = headerRows[0];

  const status: "opened" | "scheduled" | "inprogress" | "done" | "cancelled" =
    h.d_status === 1
      ? "done"
      : h.d_status === 2
        ? "cancelled"
        : h.has_detail
          ? "inprogress"
          : h.scheduled_date
            ? "scheduled"
            : "opened";

  // Lifecycle steps. Start with ເປີດບິນ (always), add ນັດສົ່ງ if scheduled,
  // then the TMS dispatch events if the bill is on a trip.
  const steps: Array<{ at: Date | string | null; label: string; remark: string | null }> = [
    { at: h.opened_at, label: "ເປີດບິນ", remark: null },
  ];
  if (h.scheduled_date) {
    steps.push({
      at: h.scheduled_date,
      label: "ນັດສົ່ງ",
      remark: h.scheduled_round,
    });
  }
  if (h.has_detail) {
    const tmsSteps = await prisma.$queryRaw<StepRow[]>`
      SELECT event_at, label, remark FROM (
        SELECT d.create_date_time_now AS event_at, 'ຈັດຖ້ຽວແລ້ວ' AS label, '' AS remark
        FROM odg_tms_detail d WHERE d.bill_no = ${bill}
        UNION ALL
        SELECT d.recipt_job, 'ຮັບຖ້ຽວ / ເບີກເຄື່ອງ', ''
        FROM odg_tms_detail d WHERE d.bill_no = ${bill} AND d.recipt_job IS NOT NULL
        UNION ALL
        SELECT b.dispatch_started_at, 'ເລີ່ມຈັດສົ່ງ', ''
        FROM odg_tms_detail d JOIN odg_tms b ON b.doc_no = d.doc_no
        WHERE d.bill_no = ${bill} AND b.dispatch_started_at IS NOT NULL
        UNION ALL
        SELECT d.sent_end,
               CASE WHEN d.status = 2 THEN 'ຍົກເລີກຈັດສົ່ງ' ELSE 'ຈັດສົ່ງສຳເລັດ' END,
               COALESCE(d.remark, '')
        FROM odg_tms_detail d WHERE d.bill_no = ${bill} AND d.sent_end IS NOT NULL
      ) e
      WHERE e.event_at IS NOT NULL
      ORDER BY e.event_at
    `;
    for (const s of tmsSteps) {
      steps.push({ at: s.event_at, label: s.label, remark: s.remark?.trim() || null });
    }
  }

  return NextResponse.json({
    billNo: h.bill_no,
    custCode: h.cust_code,
    customerName: h.customer_name?.trim() || h.cust_code || "—",
    telephone: h.telephone?.trim() || null,
    salespersonName: h.salesperson_name?.trim() || "—",
    roundName: h.round_name?.trim() || "—",
    timeLabel: h.time_label?.trim() || null,
    routeName: h.route_name?.trim() || null,
    car: h.car_label?.trim() || "—",
    driverName: h.driver_name?.trim() || "—",
    driverTel: h.driver_tel?.trim() || null,
    status,
    lat: h.lat ? Number(h.lat) : null,
    lng: h.lng ? Number(h.lng) : null,
    steps,
  });
}
