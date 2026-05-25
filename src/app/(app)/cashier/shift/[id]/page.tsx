import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ShiftRow = {
  id: bigint;
  cashier_code: string;
  cashier_name: string | null;
  branch_code: string | null;
  opened_at: Date;
  closed_at: Date | null;
  opening_cash: string | number | null;
  closing_cash: string | number | null;
  expected_cash: string | number | null;
  variance: string | number | null;
  note: string | null;
  status: string;
};

type SettleSummaryRow = {
  bill_count: bigint | number | null;
  voided_count: bigint | number | null;
  total_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  redeemed_kip: string | number | null;
  promo_kip: string | number | null;
  voided_cash_kip: string | number | null;
};

type MovementRow = {
  movement_type: string;
  amount: string | number | null;
  reason: string;
  actor_code: string;
  created_at: Date;
};

type SettleRow = {
  doc_no: string;
  cart_number: string;
  total_kip: string | number | null;
  cash_kip: string | number | null;
  transfer_kip: string | number | null;
  is_voided: boolean;
  created_at: Date;
};

const moneyFmt = new Intl.NumberFormat("en-US");

export default async function ShiftReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireEmployee();
  const { id: idStr } = await params;
  let shiftId: bigint;
  try {
    shiftId = BigInt(idStr);
  } catch {
    notFound();
  }

  const [shiftRows, summaryRows, movementRows, settleRows] = await Promise.all([
    prisma.$queryRaw<ShiftRow[]>`
      SELECT
        s.id, s.cashier_code,
        emp.fullname_lo AS cashier_name,
        s.branch_code, s.opened_at, s.closed_at,
        s.opening_cash, s.closing_cash, s.expected_cash, s.variance,
        s.note, s.status
      FROM app_cashier_shift s
      LEFT JOIN odg_employee emp ON emp.employee_code = s.cashier_code
      WHERE s.id = ${shiftId}
      LIMIT 1
    `,
    prisma.$queryRaw<SettleSummaryRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE NOT is_voided) AS bill_count,
        COUNT(*) FILTER (WHERE is_voided)      AS voided_count,
        COALESCE(SUM(total_kip)    FILTER (WHERE NOT is_voided), 0) AS total_kip,
        COALESCE(SUM(cash_kip)     FILTER (WHERE NOT is_voided), 0) AS cash_kip,
        COALESCE(SUM(transfer_kip) FILTER (WHERE NOT is_voided), 0) AS transfer_kip,
        COALESCE(SUM(redeemed_kip) FILTER (WHERE NOT is_voided), 0) AS redeemed_kip,
        COALESCE(SUM(promo_kip)    FILTER (WHERE NOT is_voided), 0) AS promo_kip,
        COALESCE(SUM(cash_kip)     FILTER (WHERE is_voided),     0) AS voided_cash_kip
      FROM app_settle_audit
      WHERE shift_id = ${shiftId}
    `,
    prisma.$queryRaw<MovementRow[]>`
      SELECT movement_type, amount, reason, actor_code, created_at
      FROM app_cash_movement
      WHERE shift_id = ${shiftId}
      ORDER BY created_at
    `,
    prisma.$queryRaw<SettleRow[]>`
      SELECT doc_no, cart_number, total_kip, cash_kip, transfer_kip,
             is_voided, created_at
      FROM app_settle_audit
      WHERE shift_id = ${shiftId}
      ORDER BY created_at
    `,
  ]);

  const shift = shiftRows[0];
  if (!shift) notFound();
  const summary = summaryRows[0];

  const billCount = Number(summary?.bill_count ?? 0);
  const voidedCount = Number(summary?.voided_count ?? 0);
  const totalKip = Number(summary?.total_kip ?? 0);
  const cashKip = Number(summary?.cash_kip ?? 0);
  const transferKip = Number(summary?.transfer_kip ?? 0);
  const redeemedKip = Number(summary?.redeemed_kip ?? 0);
  const promoKip = Number(summary?.promo_kip ?? 0);
  const voidedCashKip = Number(summary?.voided_cash_kip ?? 0);

  const opening = Number(shift.opening_cash ?? 0);
  const closing = shift.closing_cash != null ? Number(shift.closing_cash) : null;
  const expected =
    shift.expected_cash != null ? Number(shift.expected_cash) : null;
  const variance = shift.variance != null ? Number(shift.variance) : null;
  const movementsTotal = movementRows.reduce(
    (s, m) => s + Number(m.amount ?? 0),
    0,
  );
  const isClosed = shift.status === "closed";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
            Shift {isClosed ? "Z" : "X"} report
          </div>
          <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
            ກະຄິດເງິນ #{idStr}
          </h1>
          <p className="mt-1 text-sm text-odoo-text-muted">
            {shift.cashier_name ?? shift.cashier_code}
            {shift.branch_code ? ` · ສາຂາ ${shift.branch_code}` : ""}
          </p>
        </div>
        <Link href="/cashier" className="odoo-btn odoo-btn-secondary">
          ← ກັບໄປໜ້າຮັບເງິນ
        </Link>
      </header>

      <section className="mb-4 grid gap-3 rounded-md border border-odoo-border bg-odoo-surface p-4 sm:grid-cols-2">
        <Field label="ເປີດກະ" value={shift.opened_at.toLocaleString()} />
        <Field
          label="ປິດກະ"
          value={shift.closed_at ? shift.closed_at.toLocaleString() : "ຍັງເປີດຢູ່"}
        />
        <Field
          label="ເງິນສົດເລີ່ມຕົ້ນ"
          value={moneyFmt.format(opening) + " ກີບ"}
        />
        <Field
          label="ສະຖານະ"
          value={isClosed ? "ປິດແລ້ວ" : "ກຳລັງເປີດ"}
        />
      </section>

      <section className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-4">
        <h2 className="mb-3 text-sm font-bold text-odoo-text-strong">
          ສະຫຼຸບການຂາຍ
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="ຈຳນວນບິນ" value={billCount.toString()} />
          <Field label="ບິນຍົກເລີກ" value={voidedCount.toString()} />
          <Field
            label="ຍອດຂາຍລວມ"
            value={moneyFmt.format(totalKip) + " ກີບ"}
            strong
          />
          <Field
            label="ສ່ວນຫຼຸດ promo"
            value={moneyFmt.format(promoKip) + " ກີບ"}
          />
          <Field
            label="ເງິນສົດ"
            value={moneyFmt.format(cashKip) + " ກີບ"}
          />
          <Field
            label="ໂອນ"
            value={moneyFmt.format(transferKip) + " ກີບ"}
          />
          <Field
            label="ແລກແຕ້ມ"
            value={moneyFmt.format(redeemedKip) + " ກີບ"}
          />
          <Field
            label="ຄືນເງິນ (void)"
            value={moneyFmt.format(voidedCashKip) + " ກີບ"}
          />
        </div>
      </section>

      <section className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-4">
        <h2 className="mb-3 text-sm font-bold text-odoo-text-strong">
          ການເຄື່ອນເງິນ ({movementRows.length})
        </h2>
        {movementRows.length === 0 ? (
          <p className="text-[12px] text-odoo-text-muted">
            ບໍ່ມີການເຄື່ອນເງິນໃນກະນີ້
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-bold uppercase text-odoo-text-muted">
              <tr>
                <th className="py-1">ປະເພດ</th>
                <th className="py-1 text-right">ຈຳນວນ</th>
                <th className="py-1">ເຫດຜົນ</th>
                <th className="py-1">ເວລາ</th>
              </tr>
            </thead>
            <tbody>
              {movementRows.map((m, i) => (
                <tr key={i} className="border-t border-odoo-border">
                  <td className="py-1 capitalize">{m.movement_type}</td>
                  <td className="py-1 text-right font-mono">
                    {moneyFmt.format(Number(m.amount ?? 0))}
                  </td>
                  <td className="py-1 text-[12px]">{m.reason}</td>
                  <td className="py-1 text-[11px] text-odoo-text-muted">
                    {m.created_at.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-odoo-border font-bold">
                <td className="py-1">ລວມ</td>
                <td className="py-1 text-right font-mono">
                  {moneyFmt.format(movementsTotal)}
                </td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-4">
        <h2 className="mb-3 text-sm font-bold text-odoo-text-strong">
          ການກວດເງິນ
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field
            label="ເງິນສົດເລີ່ມຕົ້ນ"
            value={moneyFmt.format(opening) + " ກີບ"}
          />
          <Field
            label="+ ເງິນສົດຮັບ"
            value={moneyFmt.format(cashKip) + " ກີບ"}
          />
          <Field
            label="− ຄືນເງິນ"
            value={moneyFmt.format(voidedCashKip) + " ກີບ"}
          />
          <Field
            label="± ການເຄື່ອນເງິນ"
            value={moneyFmt.format(movementsTotal) + " ກີບ"}
          />
          <Field
            label="ເງິນທີ່ຄາດໝາຍ"
            value={
              expected != null
                ? moneyFmt.format(expected) + " ກີບ"
                : moneyFmt.format(
                    opening + cashKip - voidedCashKip + movementsTotal,
                  ) + " ກີບ (ສົດ)"
            }
            strong
          />
          <Field
            label="ເງິນທີ່ນັບໄດ້"
            value={closing != null ? moneyFmt.format(closing) + " ກີບ" : "—"}
            strong
          />
          <Field
            label="ສ່ວນຕ່າງ"
            value={
              variance != null
                ? (variance >= 0 ? "+" : "") +
                  moneyFmt.format(variance) +
                  " ກີບ"
                : "—"
            }
            strong
            danger={variance != null && variance !== 0}
          />
        </div>
      </section>

      {settleRows.length > 0 ? (
        <section className="mb-4 rounded-md border border-odoo-border bg-odoo-surface p-4">
          <h2 className="mb-3 text-sm font-bold text-odoo-text-strong">
            ບິນທີ່ຮັບ ({settleRows.length})
          </h2>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] font-bold uppercase text-odoo-text-muted">
              <tr>
                <th className="py-1">ເລກບິນ</th>
                <th className="py-1 text-right">ຍອດ</th>
                <th className="py-1 text-right">ສົດ</th>
                <th className="py-1 text-right">ໂອນ</th>
                <th className="py-1">ສະຖານະ</th>
                <th className="py-1">ເວລາ</th>
              </tr>
            </thead>
            <tbody>
              {settleRows.map((r) => (
                <tr
                  key={r.doc_no}
                  className={`border-t border-odoo-border ${r.is_voided ? "opacity-50 line-through" : ""}`}
                >
                  <td className="py-1 font-mono text-[12px]">
                    <Link
                      href={`/cashier/receipts/${r.doc_no}`}
                      className="text-odoo-link hover:underline"
                    >
                      {r.doc_no}
                    </Link>
                  </td>
                  <td className="py-1 text-right font-mono">
                    {moneyFmt.format(Number(r.total_kip ?? 0))}
                  </td>
                  <td className="py-1 text-right font-mono text-[12px]">
                    {moneyFmt.format(Number(r.cash_kip ?? 0))}
                  </td>
                  <td className="py-1 text-right font-mono text-[12px]">
                    {moneyFmt.format(Number(r.transfer_kip ?? 0))}
                  </td>
                  <td className="py-1 text-[11px]">
                    {r.is_voided ? "ຍົກເລີກ" : "ປົກກະຕິ"}
                  </td>
                  <td className="py-1 text-[11px] text-odoo-text-muted">
                    {r.created_at.toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {shift.note ? (
        <section className="rounded-md border border-odoo-border bg-odoo-surface-muted p-3 text-[12px] text-odoo-text">
          <strong>ໝາຍເຫດ:</strong>{" "}
          <span className="whitespace-pre-wrap">{shift.note}</span>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
        {label}
      </div>
      <div
        className={
          (strong ? "text-base font-bold " : "text-sm font-semibold ") +
          (danger ? "text-odoo-danger" : "text-odoo-text-strong")
        }
      >
        {value}
      </div>
    </div>
  );
}
