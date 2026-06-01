import { requireEmployee } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CURRENCY_LABEL, type CurrencyCode } from "@/lib/payment";

export const dynamic = "force-dynamic";

const moneyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const todayIso = (() => {
  const now = new Date();
  // Day boundary follows the server's timezone — UTC+7 in our deployments.
  const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 10);
})();

function isValidDate(s: string | undefined): s is string {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

type HeaderRow = {
  doc_no: string;
  doc_date: string;
  doc_time: string | null;
  cust_code: string | null;
  customer_name: string | null;
  sale_code: string | null;
  salesperson_name: string | null;
  total_amount_kip: string | number | null;
  is_cancel: number | null;
};

type PaymentLineRow = {
  doc_no: string;
  currency_code: string;
  pay_method: "cash" | "transfer";
  amount: string | number | null;
  amount_in_main: string | number | null;
};

type SlipCountRow = {
  doc_no: string;
  slip_count: number | string;
};

type BreakdownKey = `${CurrencyCode}:cash` | `${CurrencyCode}:transfer`;

export default async function DailyPaymentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireEmployee();
  const params = await searchParams;
  const selectedDate =
    params.date && isValidDate(params.date) ? params.date : todayIso;

  const [headers, payments, slips] = await Promise.all([
    prisma.$queryRaw<HeaderRow[]>`
      SELECT
        t.doc_no,
        TO_CHAR(t.doc_date, 'YYYY-MM-DD') AS doc_date,
        t.doc_time,
        t.cust_code,
        ar.name_1 AS customer_name,
        NULLIF(t.sale_code, '') AS sale_code,
        COALESCE(emp.fullname_lo, emp.nickname, t.sale_code) AS salesperson_name,
        t.total_amount_2 AS total_amount_kip,
        t.is_cancel
      FROM ic_trans t
      LEFT JOIN ar_customer ar ON ar.code = t.cust_code
      LEFT JOIN odg_employee emp ON emp.employee_code = NULLIF(t.sale_code, '')
      WHERE t.doc_format_code = 'CAKAP'
        AND t.doc_date = ${selectedDate}::date
      ORDER BY t.doc_time NULLS LAST, t.doc_no
    `,
    prisma.$queryRaw<PaymentLineRow[]>`
      SELECT
        p.doc_no,
        p.currency_code,
        p.pay_method,
        p.amount,
        p.amount_in_main
      FROM app_payment_line p
      JOIN ic_trans t ON t.doc_no = p.doc_no AND t.doc_format_code = 'CAKAP'
      WHERE t.doc_date = ${selectedDate}::date
    `,
    prisma.$queryRaw<SlipCountRow[]>`
      SELECT s.doc_no, COUNT(*)::int AS slip_count
      FROM app_transfer_slip s
      JOIN ic_trans t ON t.doc_no = s.doc_no AND t.doc_format_code = 'CAKAP'
      WHERE t.doc_date = ${selectedDate}::date
      GROUP BY s.doc_no
    `,
  ]);

  // Bucket payment lines by doc_no for per-row totals.
  const paymentsByDoc = new Map<string, PaymentLineRow[]>();
  for (const p of payments) {
    const list = paymentsByDoc.get(p.doc_no) ?? [];
    list.push(p);
    paymentsByDoc.set(p.doc_no, list);
  }
  const slipsByDoc = new Map<string, number>();
  for (const s of slips) slipsByDoc.set(s.doc_no, Number(s.slip_count));

  // Aggregate totals across the whole day.
  let totalReceiptsActive = 0;
  let totalReceiptsCancelled = 0;
  let totalKipActive = 0;
  let totalKipCancelled = 0;
  const breakdown: Record<BreakdownKey, number> = {
    "02:cash": 0,
    "02:transfer": 0,
    "01:cash": 0,
    "01:transfer": 0,
  };
  for (const h of headers) {
    const kip = h.total_amount_kip ? Number(h.total_amount_kip) : 0;
    if (h.is_cancel) {
      totalReceiptsCancelled += 1;
      totalKipCancelled += kip;
    } else {
      totalReceiptsActive += 1;
      totalKipActive += kip;
    }
  }
  for (const p of payments) {
    const header = headers.find((h) => h.doc_no === p.doc_no);
    if (!header || header.is_cancel) continue;
    const key = `${p.currency_code}:${p.pay_method}` as BreakdownKey;
    if (key in breakdown) {
      breakdown[key] += p.amount ? Number(p.amount) : 0;
    }
  }

  // Per-row currency × method aggregates for the table.
  function rowBreakdown(docNo: string) {
    const list = paymentsByDoc.get(docNo) ?? [];
    const r: Record<BreakdownKey, number> = {
      "02:cash": 0,
      "02:transfer": 0,
      "01:cash": 0,
      "01:transfer": 0,
    };
    for (const p of list) {
      const key = `${p.currency_code}:${p.pay_method}` as BreakdownKey;
      if (key in r) r[key] += p.amount ? Number(p.amount) : 0;
    }
    return r;
  }

  return (
    <div className="odoo-page">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="odoo-label">ລາຍງານ</div>
          <h1 className="mt-2 text-2xl font-bold text-odoo-text-strong">
            ສະຫຼຸບການຮັບເງິນປະຈຳວັນ
          </h1>
          <p className="mt-1 text-sm text-odoo-text">
            ໃບຮັບເງິນ (CAKAP) ທີ່ບັນທຶກໃນວັນທີ່ເລືອກ — ແຍກຕາມສະກຸນເງິນ ແລະ ປະເພດການຮັບ.
          </p>
        </div>
        <form
          method="get"
          className="flex items-end gap-2"
        >
          <div>
            <label className="odoo-label mb-1 block" htmlFor="date">
              ວັນທີ
            </label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={selectedDate}
              className="odoo-input"
            />
          </div>
          <button type="submit" className="odoo-btn odoo-btn-primary">
            ດຶງລາຍງານ
          </button>
        </form>
      </header>

      <section className="mb-4 grid gap-3 sm:grid-cols-4">
        <SummaryCard
          label="ໃບຮັບເງິນ"
          value={moneyFmt.format(totalReceiptsActive)}
          subtitle={
            totalReceiptsCancelled > 0
              ? `+${totalReceiptsCancelled} ໃບຍົກເລີກ`
              : undefined
          }
          tone="indigo"
        />
        <SummaryCard
          label="ຍອດຮັບ (ກີບ)"
          value={moneyFmt.format(totalKipActive)}
          subtitle={
            totalKipCancelled > 0
              ? `−${moneyFmt.format(totalKipCancelled)} ຍົກເລີກ`
              : undefined
          }
          tone="emerald"
        />
        <SummaryCard
          label="ສົດ ກີບ + ບາທ"
          value={`${moneyFmt.format(breakdown["02:cash"])} / ${moneyFmt.format(breakdown["01:cash"])}`}
          subtitle="LAK / THB"
          tone="slate"
        />
        <SummaryCard
          label="ໂອນ ກີບ + ບາທ"
          value={`${moneyFmt.format(breakdown["02:transfer"])} / ${moneyFmt.format(breakdown["01:transfer"])}`}
          subtitle="LAK / THB"
          tone="slate"
        />
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["02", "01"] as CurrencyCode[]).flatMap((c) =>
          (["cash", "transfer"] as const).map((m) => (
            <div
              key={`${c}:${m}`}
              className="rounded-md border border-odoo-border bg-white px-4 py-3"
            >
              <div className="text-xs font-semibold text-odoo-text-muted">
                {m === "cash" ? "ສົດ" : "ໂອນ"} {CURRENCY_LABEL[c].name}{" "}
                <span className="text-[10px] text-odoo-text-soft">
                  {CURRENCY_LABEL[c].short}
                </span>
              </div>
              <div className="mt-1 font-mono text-lg font-bold text-odoo-text-strong">
                {moneyFmt.format(breakdown[`${c}:${m}` as BreakdownKey])}
              </div>
            </div>
          )),
        )}
      </section>

      <section className="odoo-card overflow-hidden">
        <div className="border-b border-odoo-border px-4 py-3 text-sm font-semibold text-odoo-text-strong">
          ລາຍລະອຽດໃບຮັບເງິນ ({headers.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs uppercase tracking-wide text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">ເລກໃບຮັບ</th>
                <th className="px-4 py-3 font-semibold">ເວລາ</th>
                <th className="px-4 py-3 font-semibold">ລູກຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ພະນັກງານ</th>
                <th className="px-4 py-3 text-right font-semibold">ສົດ LAK</th>
                <th className="px-4 py-3 text-right font-semibold">ໂອນ LAK</th>
                <th className="px-4 py-3 text-right font-semibold">ສົດ THB</th>
                <th className="px-4 py-3 text-right font-semibold">ໂອນ THB</th>
                <th className="px-4 py-3 text-right font-semibold">ລວມ (ກີບ)</th>
                <th className="px-4 py-3 text-right font-semibold">Slip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-odoo-border">
              {headers.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-12 text-center text-sm text-odoo-text-muted"
                  >
                    ບໍ່ມີໃບຮັບເງິນໃນວັນທີ ${selectedDate}
                  </td>
                </tr>
              ) : (
                headers.map((h) => {
                  const r = rowBreakdown(h.doc_no);
                  const slipCount = slipsByDoc.get(h.doc_no) ?? 0;
                  const kip = h.total_amount_kip
                    ? Number(h.total_amount_kip)
                    : 0;
                  return (
                    <tr
                      key={h.doc_no}
                      className={
                        "text-odoo-text-strong" +
                        (h.is_cancel ? " opacity-60 line-through" : "")
                      }
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold">
                        {h.doc_no}
                      </td>
                      <td className="px-4 py-3 text-xs text-odoo-text-muted">
                        {h.doc_time ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-odoo-text-strong">
                          {h.customer_name ?? h.cust_code ?? "—"}
                        </div>
                        {h.cust_code ? (
                          <div className="font-mono text-[10px] text-odoo-text-soft">
                            {h.cust_code}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {h.salesperson_name ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {r["02:cash"] > 0 ? moneyFmt.format(r["02:cash"]) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {r["02:transfer"] > 0
                          ? moneyFmt.format(r["02:transfer"])
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {r["01:cash"] > 0 ? moneyFmt.format(r["01:cash"]) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {r["01:transfer"] > 0
                          ? moneyFmt.format(r["01:transfer"])
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-odoo-primary">
                        {moneyFmt.format(kip)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {slipCount > 0 ? (
                          <span className="odoo-pill odoo-pill-info">
                            {slipCount}
                          </span>
                        ) : (
                          <span className="text-odoo-text-soft">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  tone,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone: "indigo" | "emerald" | "slate";
}) {
  const styles: Record<string, string> = {
    indigo: "border-odoo-primary-200 bg-odoo-primary-50 text-odoo-primary",
    emerald:
      "border-odoo-success-border bg-odoo-success-bg text-odoo-success-text",
    slate: "border-odoo-border bg-white text-odoo-text-strong",
  };
  return (
    <div className={`rounded-md border px-4 py-3 ${styles[tone]}`}>
      <div className="text-xs font-semibold text-current/65">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold">{value}</div>
      {subtitle ? (
        <div className="mt-0.5 text-[10px] font-semibold text-current/55">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
